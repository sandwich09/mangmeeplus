# Feature-Disabled Error Honesty Plan

Spec: `docs/specs/feature-disabled-error-honesty-spec.md`
Diagnosis record: `docs/agent-memory/uat-print-file-open-diagnosis.md`
Mode: ponytail full — shortest correct diff, single-seam reuse, no new abstractions.
Worktree note: shared dirty tree (concurrent session owns `.github/workflows/f2-*`,
`apps/api/prisma/normalize-entitlements.ts`, `get-launch-health.use-case.ts`,
`docs/runbooks/feature-launch-control.md`, a5-readonly files) — this plan touches none of
those files; every commit stages its own files explicitly (never `git add -A`).

## Piece 1 — docs (this commit)

- `docs/specs/feature-disabled-error-honesty-spec.md`
- `docs/plans/feature-disabled-error-honesty-plan.md`
- `docs/runbooks/uat-feature-package-provisioning.md` — how the owner enables document
  families for UAT acceptance via the existing permission-checked API
  (`PUT /v1/system/partners/:partnerCompanyId/features`, `system.partner_feature.manage`)
  or the Partner Companies screen presets; verification via
  `GET /v1/system/launch-gates/health` featureLifecycle. No new code.

## Piece 2 — web: route every screen through the shared translator

One-line body changes (import + delegate), no call-site churn:

- `err()` → `apiErrorMessage(e)`: `accounting-documents/AccountingPages.tsx`,
  `tax/TaxWorkspacePage.tsx`, `accounts-payable/AccountsPayablePages.tsx`,
  `ledger/LedgerReportsPage.tsx`, `workflow/WorkflowPages.tsx`, `banking/BankingPages.tsx`,
  `banking/MatchingPanel.tsx`, `banking/StatementImportPanel.tsx`,
  `procurement/ProcurementPages.tsx`, `crm/CrmPages.tsx`, `crm/Customer360Page.tsx`,
  `ai-suggestions/AiSuggestionsPages.tsx`.
- `transaction-tax.model.ts:transactionTaxErrorMessage` — consult the shared code map
  (`translateApiError(code)`) before the blanket 403 branch; keep 409/422 branches.
- `reimbursements/ReimbursementsPages.tsx:err` — consult the object `code` via the shared
  map first, then fall back to the existing message-string `errorMessage` path.

Checks: extend `api-error-message.spec` (or the nearest existing logic spec) with the
message-less coded-403 shape; add/extend `transaction-tax.model` spec for the
entitlement-403 branch; reimbursements logic spec for object-coded errors. Then
`pnpm --filter web typecheck` + web test suite + one live browser pass (flip
seed-local-company rows false → tax page shows "ยังไม่ได้เปิดฟีเจอร์นี้" → restore rows).

## Piece 3 — api: retained-reports copy

`apps/api/src/modules/reports/application/report.use-cases.ts` — the
`legacy_export_not_materialized` list projection branches its Thai copy on
`reportsEnabled`, mirroring the adjacent `report_export_expired` branch. The download
`GoneException` sibling stays single-message: while OFF, `ensureOriginalSourceAuthority`
throws `report_artifact_authority_changed` before it (verified by the existing spec), so
adding a branch there would ship dead code — a comment records the proof instead.
Update the existing assertions in `report.use-cases.spec.ts`; run that spec + api
typecheck.

## Piece 4 — live-UAT AI safety and human-readable review

- API refuses candidate validation, source-draft creation and every review decision
  except regeneration or dismissal (including the dismissal-equivalent
  `MARK_NOT_USEFUL`) when the suggestion has `needsDataReasons`, using stable code
  `ai_suggestion_needs_data` before any write or adapter call.
  `NO_SOURCE_DRAFT_AVAILABLE` is removed from self-owned draft support and fails closed
  with `ai_source_draft_unavailable`, including a direct adapter call.
- Web passes `needsData` into the action guard, so only regeneration/dismissal remains.
  Exhaustive Thai maps replace risk/status/action/review codes; known needs-data reasons
  get actionable Thai copy; checklist title/items are primary and JSON/validation detail
  is collapsed under support detail. The shared API error seam maps both new codes.
- Focused API/web logic tests cover both guards, adapter non-invocation, the CRM happy
  path, exhaustive labels, payload whitelist, duplicate-summary handling and friendly
  validation copy. Run API/web typecheck and the complete web suite, then deploy only
  the exact green `develop` SHA to UAT and repeat the browser fixture.

Verification record (2026-08-03): piece 1 `ed787036`, piece 2 `a2d8b33e` (web typecheck
green, web suite 615/615 incl. new transaction-tax + reimbursements cases), piece 3
`0f97c5d1` (report.use-cases.spec 33/33, api tsc clean). Live checks: seed company rows
flipped false → coded 403 bodies confirmed at the API; direct /tax deep link is
server-redirected to the dashboard while OFF (nav guard), so the honest message surfaces
on cross-family calls and in-place actions; rows restored to true afterwards.

Piece 4 closed at `544bdd25be6ba44feb26eb7008104fffe6f7bece`: focused API/web
59/59, API/web typechecks, complete registered API suite and web 623/623 passed; exact
push CI `30804548851` passed. The first deploy attempt `30805100080` failed closed in
validation on a transient package-registry socket termination before publish/deploy; it
was not a vulnerability result and changed no service. Retry `30805641789` deployed the
exact SHA to UAT and passed signed release-task acceptance, health, retirement,
finalization and M-01. Against the existing Bedrock-produced `needsData` artifact,
validate, create-source-draft and direct `ACCEPT_AS_SOURCE_DRAFT` review each returned
422 `ai_suggestion_needs_data`; the canonical before/after state was identical (`NEW`,
candidate `PROPOSED`, zero reviews). The browser rendered Thai risk/status/reason/action
copy, showed only regenerate/dismiss, and exposed neither validate nor create-draft.
Final read-only A5/F2 PLAN run `30808101502` re-pinned the serving SHA before and after
collection and passed. Technical JSON is collapsed for an authorized page user; this
plan does not claim server redaction or support-role-only access.

## Commit/push sequence

One commit per piece on `develop`, pushed immediately after its verification:
1. `docs(feature-ux): spec+plan+runbook for feature-disabled error honesty`
2. `fix(web): surface feature_not_enabled truthfully through the shared error seam`
3. `fix(reports): retained-history copy stops instructing disabled companies to re-export`
4. `fix(ai): keep needs-data suggestions review-only and human-readable`

## Rollback / risk

- No schema, success-DTO, entitlement or permission change landed. Piece 4 adds two
  stable error-contract codes and a fail-closed safety precondition before validation,
  review or source-draft mutation.
- Presentation-only regressions may be reverted independently. Do not revert the API
  needs-data guard by itself: a rollback must retain that guard or disable the affected AI
  mutation flow until an equivalent safety fix is deployed.
- Screens keep passing unknown messages through, so no information is lost for support.
