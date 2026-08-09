# Agent Memory: production-readiness-medium-remediation

Status: IN PROGRESS — M8-01..M8-10 and related-view follow-ups committed through procurement; substitute-receipt R1 in progress.
Owner: thawatchai
Scope: Verify, reclassify, fix and individually commit every finding in section 8 (MEDIUM) of
`docs/qa/production-readiness-audit-consolidated-2026-08-09.md`; record newly discovered bugs/gaps and fix them in the
same atomic issue when required for correctness.
Decisions:
- One finding/root cause per commit. A bundled bullet may split into atomic commits; false, already-fixed, accepted-scope
  or duplicate findings are closed with evidence instead of speculative code.
- Focused runnable verification is required before every commit; broader gates run after each domain group.
- Preserve and do not stage the pre-existing uncommitted accounting-UI changes in five `apps/web/src/features/expenses`
  and `web-core-workspace` files unless their owner resolves them or a later finding cannot be isolated.
- `production-readiness-audit-2026-08-09.md` and `production-readiness-usecase-audit-2026-08-09.md` remain untracked and
  out of all commits.
- CR-3 owner decision remains: accounting UI hidden, ledger core/background posting active.
- Owner decision 2026-08-09: authenticated company members related as creator/requester, assignee/handler, approver,
  payer/payee/payment actor, issuer/void actor, or through linked documents may view the tenant/branch-scoped record chain.
  Relationship is view-only; every mutation still requires action permission/role plus the current state.
Open questions:
- None blocking M8-01. Findings that require a product policy decision will be marked `DECISION_REQUIRED` rather than guessed.
Artifacts:
- Consolidated audit section 8 contains 49 top-level/bundled Medium findings across auth, finance/date, substitute receipt,
  settings/entitlement, dashboard/notifications/reports, LINE/AI, reimbursement, platform, i18n and onboarding.
- This memory tracks progress across turns; detailed disposition is written back beside each finding in the consolidated audit.
Verification:
- Baseline worktree inspected 2026-08-09. Five unrelated web files are modified; three QA audit files are untracked.
- M8-01 focused tests: 50/50 pass across token issuance, password login/reset/change, controller session binding and employee
  credential regeneration.
- M8-01 discovered and fixed a related TOCTOU race: an old password verified before a concurrent credential update could
  create a session after revocation. Password-backed issuance now locks and rechecks the credential version before creating
  the session in the same transaction.
- API `tsc --noEmit` reaches only 14 pre-existing test errors: 11 missing `ObjectVersionCleanupService` constructor arguments
  in `substitute-receipt.use-case.spec.ts` and 3 mock tuple typing errors in `report.use-cases.spec.ts`; no M8-01 file errors.
- M8-01 commit: `87d6c0e fix(auth): revoke sessions after credential changes`.
- M8-02 audit tests: 26/26 pass; RPT E2E file compiles/lists all 8 cases. The endpoint is tenant-explicit at
  `/companies/:companyId/audit/logs`, route/context mismatch fails before repository access, and specs/caller match.
- M8-02 commit: `5be8d78 fix(audit): bind log queries to route company`.
- M8-03 AuthGuard/deny-by-default tests: 25/25 pass. Central guard rejects conflicting header/route tenant selectors only
  after authentication/session validation and before context resolution; missing/invalid credentials retain 401 ordering.
- M8-03 commit: `efe097f fix(auth): reject conflicting company selectors`.
- M8-04 focused web tests: 26/26 pass; contracts build and web `tsc --noEmit` pass. Visible workspaces revalidate access
  every 60 seconds, on focus/visibility return and immediately after stable permission/feature denial. Fingerprints include
  roles, effective permissions and branch scopes; fetches are single-flight and denied mutations are never retried.
- M8-04 commit: `5e53f11 fix(web): refresh stale access context`.
- M8-05 focused API tests: 124/124 pass. Journal source dates, persisted `@db.Date` values, document numbers, tax periods
  and closed-period guards now share the Bangkok civil-date boundary. A `2026-08-31T19:00:00Z` settlement posts on
  `2026-09-01` in `2026-09`; malformed/out-of-range monthly keys fail instead of rolling silently.
- M8-05 related gaps fixed in the same root-cause change: accounting/procurement/inventory sequence numbers and tax form
  periods also used host-local or UTC month calculations and could disagree with their journal. API `tsc --noEmit` still
  reports only the established 14 errors in substitute-receipt/report specs and no M8-05 file error.
- M8-05 commit: `6a70e2e fix(finance): normalize Bangkok business periods`.
- A concurrent CR-2 commit initially swept M8-05 staging and all untracked QA files into one commit. The latest local commit
  was split without losing content: CR-2 is `1b71614`, M8-05 is `6a70e2e`, and all three QA files remain outside git.
- M8-06 Thai-date boundary tests: 6/6 pass; web `tsc --noEmit` passes. Shared date/time/month formatters and three bypassing
  timestamp call sites now render in `Asia/Bangkok`; the UTC Aug-31 19:00 instant renders as Sep-1 02:00 in Bangkok.
- M8-06 commit: `062cc73 fix(web): render business dates in Bangkok time`.
- M8-07 focused tests: DeleteExpense 33/33 and web expense model 47/47 pass; web `tsc --noEmit` passes. Delete now checks
  branch scope and permission before document state/linked data, preserves company-central visibility, and uses a final
  `updatedAt` + tenant + branch-scope CAS so a concurrent confirm/branch move rolls the transaction back.
- M8-07 commit: `d89df19 fix(expenses): enforce branch scope on deletion`.
- M8-08 focused API tests 72/72 and web error-message tests 18/18 pass; contracts build and web typecheck pass. Interactive
  draft/review/override/OCR writes require the loaded `updatedAt` and return a stable 409 on a stale save; LINE correction
  also carries its loaded version. Replacement-line writes were moved into the successful header CAS transaction, fixing
  the related partial-update window where lines could persist even though the header write failed.
- API `tsc --noEmit` still reaches only the established 14 unrelated errors in substitute-receipt/report specs; no M8-08
  file error.
- M8-08 commit: `995fae5 fix(expenses): prevent stale draft overwrites`.
- M8-09 was reclassified: draft void already existed and user-route hard delete is intentionally forbidden by the source
  spec. The missing PATCH/UI now edits DRAFT only with branch/permission/money/tax validation, `updatedAt` CAS, and one
  transaction for header, replacement lines, and tax snapshots; issue/update/void share a lifecycle lock.
- M8-09 related access gap fixed: type-specific accounting permissions now pass controller, use-case, navigation, and access
  matrix gates; list queries are narrowed to readable document types instead of granting generic document visibility.
- M8-09 owner relation policy implemented across web/API/LINE AI: all company roles receive the view-only
  `accounting.document.read_related` path, but entitlement filtering removes it when `sales_documents` is off. The source
  graph follows actor, source/conversion and payment-allocation links to cycle-safe closure with tenant/branch filtering;
  mutation permission and state checks are unchanged. Existing custom roles receive an additive universal backfill.
- M8-09 related gaps fixed during use-case play: the first graph pass stopped at ten links and did not connect sibling
  documents allocated to one payment; traversal now reaches finite closure through both paths and source/conversion indexes
  keep child-link queries indexed. LINE/AI registry and preview gates now honor any-of relation/type reads, then repeat ABAC
  in the source use case. The draft editor now carries hidden product/SKU/unit/category line metadata through full replacement,
  and submit/convert/correction controls require the exact action and target-document permission instead of state/generic
  permission alone.
- M8-09 verification: focused API/accounting/auth/access/AI 179/179, LINE/AI API 202/202, AI Gateway 93/93, focused web
  86/86 and full web 863/863 pass. Prisma schema validate, contracts build, AI Gateway/web typechecks pass. API typecheck
  has no M8-09 error and still reports only the established 14 errors in substitute-receipt/report specs.
- M8-09 commit: `f913945 fix(accounting): secure draft correction and related views`.
- M8-09B closes the newly found split-transaction conversion gap: quotation lifecycle lock + loaded-version CAS now owns
  source close and target creation in one serializable transaction. A completed same-target retry returns the persisted
  target without duplicate audit/outbox; a legacy partial target is completed once, while different/multiple targets fail 409.
- M8-09B focused conversion/use-case tests: 13/13; expanded accounting/auth/access/AI regression: 184/184; web error copy: 20/20 pass.
  Web typecheck passes. API typecheck reports no M8-09B errors; it still has the established substitute-receipt/report test errors plus one
  concurrent reimbursement edit error outside this commit.
- Concurrent unrelated work continues in the shared worktree and remains outside M8-09 staging.
- M8-09B commit: `c6f381d fix(accounting): make quotation conversion atomic`.
- M8-10 replaces the lossy payment aggregate mutation with append-only `ExpensePayment` facts. Each partial
  payment accumulates through Decimal arithmetic under a serializable lifecycle lock and CAS; accrual and
  settlement posting states/JV identities no longer overwrite one another.
- M8-10 impact gaps fixed during use-case play: substitute-receipt approval now appends only its remaining
  paid amount; Auto-post drains payment events only after the accrual is posted; void reverses every posted
  payment journal and terminalizes all events; an unposted void no longer leaves a false pending status;
  bank matching now allocates each payment event independently instead of collapsing partial payments into
  one aggregate source.
- Legacy migration reuses the expense id for the single backfilled payment so immutable existing settlement
  journals remain linked, and distinguishes an accrual posting error from a settlement posting error.
- M8-10 verification: focused payment/posting/substitute/void/Auto-post/banking tests 57/57 and web error-copy
  tests 21/21 passed; broader API expense/ledger and web expense/common-api suites passed without failures.
  Contracts build and web typecheck passed. API typecheck has no M8-10 errors and reaches only the established
  14 substitute-receipt/report spec errors. Prisma validate/generate passed, and all 126 migrations including
  the final claim-excluding backfill applied successfully to a clean temporary PostgreSQL database.
- M8-10 commit: `40d0fb7 fix(expenses): preserve partial payment history`.
- Owner access-policy follow-up: accounting documents already comply. Expense/substitute-receipt is the first
  remaining family: `expense.read_related` is universal only while the expenses feature is enabled, and its
  list/detail/LINE-AI paths resolve persisted actors under tenant/branch scope. No mutation capability is implied.
- Expense related-view verification: focused API permission/feature/ABAC/LINE tests 138/138 passed; final
  feature-off and relation subset 43/43 passed; focused web and AI Gateway tests passed (AI 81/81).
  Contracts build plus web/AI Gateway typechecks passed. API typecheck has no related-view errors: it retains
  the established 14 test errors plus one error in an untracked concurrent payer-access spec excluded from
  this commit. Prisma validate/generate passed, and all 127 migrations applied to a
  clean PostgreSQL database. Impact gaps fixed before commit: system-role/core-pack parity, expenses.list-off
  stripping, real OCR action guards, nested category-read contract parity, company-central branch visibility,
  collision-safe branch/relation/month predicates, and PostgreSQL-safe index names.
- Expense/substitute-receipt related-view commit: `6cfea99 fix(expenses): allow related actors to view records`.
- Reimbursement related-view follows direct request/workflow/payment/signature/signed-copy actors plus related linked or
  generated expenses. `reimbursement.read_related` is universal through core/backfill but stripped when reimbursement is
  off; list/detail/claim form/LINE-AI repeat tenant and branch ABAC. Requester UI actions repeat identity, exact permission
  and state, so a related approver cannot edit, submit or cancel another employee's draft.
- Impact gaps fixed during reimbursement use-case play: finance queue and AI summary were not branch-filtered; relation
  filters now keep branch and actor OR clauses under separate AND predicates, retain company-central records, and repeat
  branch scope on linked expense hops. The old requester-only tab would have exposed submit/cancel buttons after widening;
  it is now labelled related and mutation controls are independently gated. Actor OR arms received supporting indexes. The
  role-template guard also misclassified `.read_related` as a write and demanded broad `.read`; it now distinguishes scoped
  read keys without weakening paired-read checks for real mutations.
- Reimbursement related-view verification: focused API permission/feature/reimbursement/LINE tests 231/231, focused web
  126/126, AI Gateway 87/87 and contracts feature tests 12/12 passed. Contracts build, Prisma validate/generate and web/AI
  Gateway typechecks passed. API typecheck reports only the established 14 substitute-receipt/report spec errors. All 128
  migrations applied successfully to a clean temporary PostgreSQL database, which was then removed.
- Procurement owner-policy follow-up uses five universal, exact-submenu-gated related-read permissions across the persisted
  PR → PO → goods receipt → vendor bill → supplier payment graph. It walks links to closure in both directions, includes
  immutable successful audit/approval actors so a later header update does not erase an earlier participant, and never
  relates documents merely because they share a supplier. Supplier master/bank, AP reports/WHT/posting sources and every
  mutation remain exact-permission paths.
- New gap found and fixed while playing the use cases: procurement list/detail and many mutation preload paths ignored
  `RequestContext.scopes.branchIds`, so a branch-restricted role could cross branches. All five lists, details and mutation
  preloads now fail closed by branch; scoped PR/PO/receipt creation cannot create a central/cross-branch record. Receipt
  creation also rejects a non-receivable PO, mismatched supplier/branch and lines owned by another PO.
- A second source-integrity gap allowed a PO to point at a draft/already-converted/cross-branch PR or foreign PR lines,
  while leaving the PR approved and permitting a concurrent duplicate conversion. Conversion now validates the complete
  PR lineage and claims `APPROVED -> CONVERTED` in the same serializable transaction as PO creation.
- Procurement verification: all module specs 212/212, permission/feature/access/ERP-AI tests 125/125, LINE menu 16/16,
  focused web 100/100 and AI Gateway 76/76 pass. Contracts build and web/AI Gateway typechecks pass. Prisma validate/
  generate pass, and all 129 migrations applied to a clean PostgreSQL database; the migration table confirmed 129
  completed rows before the temporary database was removed. API typecheck has no procurement error and retains only the
  established 14 substitute-receipt/report spec errors.
- Substitute-receipt H-4 follow-up aligns `expense.read_own` across detail, hub and history: the payer of any current or
  superseded evidence version can open the certificate journey without `expense.review`, while an unrelated company
  member remains denied. Focused payer/relation tests 15/15 and the expanded expenses + permission suite 555/555 pass;
  committed as `0e9421a`.
- Substitute-receipt running number is allocated and committed atomically with the evidence under
  `expense.substitute_receipt` (`SRC-{YYYY}{MM}-{SEQ}`), uses the Bangkok preparation month, and an idempotent retry does
  not consume another number. The printed form uses the human-readable certificate number as its item reference until
  the expense receives its confirmation number, never `-` or the internal cuid. Sequence/repository/renderer tests
  30/30 pass; API typecheck retains the same established 14 spec-only errors.
- Substitute-receipt rendering delegates all civil and signature timestamps to the shared Thai date formatter pinned to
  `Asia/Bangkok`; a payer/approver signing after UTC 17:00 now prints the following Thai day instead of the preceding UTC
  date. The renderer regression covers both signatures at this boundary.
- Voiding a confirmed expense now retires every issued substitute evidence and its committed running number in the same
  transaction as the accounting reversal. The immutable/checksummed SVG remains untouched; every page of a derived
  download is stamped `VOID`, while an older corrected version is stamped `SUPERSEDED`. The hub exposes those historical
  artifacts for audit instead of showing a dead download journey. This also closes a newly found UI/API mismatch where
  the wizard offered a superseded artifact but the API always answered 409.
- Void/download/permission focused tests pass 37/37 and the complete expenses module passes 450/450. Web typecheck passes;
  API typecheck has no new errors and retains only the established 14 substitute-receipt/report spec errors.
Next:
- Substitute-receipt R1 is closed: the company-central hub predicate was already fixed and directly regression-tested in
  `6cfea99`; the complete expenses suite reconfirmed it. Continue the next section-8 R1 finding.
