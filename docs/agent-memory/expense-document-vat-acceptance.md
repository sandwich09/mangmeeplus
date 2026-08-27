# Agent Memory: expense-document-vat-acceptance

Status: Implemented and integration-verified on `codex/expense-document-vat-acceptance`; remote delivery pending. Initial base `2ef787b1cabf08f0958890d5b6f2ce68e327b2d6`.
Owner: /root/expense_document_vat_acceptance
Scope: Complete existing reviewer “ใช้ยอดตามเอกสาร” confirmation. No navigation redesign, duplicate mixed-VAT work, historical rewrite, deployment, schema or dependency change.

## Product and architecture decision

- Follow expense VAT source spec §§9,12,13 and priority plan §13.11.B. Reviewer + confirm permissions, written reason and a selected positive-VAT carrier remain mandatory.
- Source VAT and original calculated VAT remain evidence. After explicit acceptance, accepted line/header VAT must equal source VAT, with included gross fixed or excluded base fixed. Reuse existing residual/WHT helpers, including explicit baht WHT. Never adjust a zero/exempt/non-VAT line.
- Add an explicit `REVIEWER_ACCEPTED` snapshot status, not a false `MATCHED`; source and calculated difference remain unchanged. Existing blocking-status allowlist treats acceptance as resolved. Update the sole status-label consumer and contract tests.
- Re-read version/checksum in existing serializable confirmation transaction; then derive accepted amounts, finalize tax from them, persist header/lines, outbox and override audit atomically. Failed validation, period lock, tax finalization, audit or CAS leaves the draft unchanged.
- The override request now requires `expectedUpdatedAt` from the reviewed detail. This closes the pre-POST stale-screen gap, in addition to transaction CAS. Ordinary `{}` confirmation is unchanged. An older client attempting an override without a version fails closed and must reload the updated UI; no legacy unsafe fallback.
- Invalid/missing source, unknown treatment, rate conflict, conflicting line-level source, negative/overflow result and stale records fail closed. No public accepted amounts or derived status input.
- A plain receipt without Tax Code may accept an over-capture-tolerance document amount. A configured-tax line still obeys its stricter Tax Code/profile tolerance and evidence/account/report gates. A narrow internal-only tax resolver option preserves accepted values *within* that policy, instead of silently replacing them with calculated values. No tax-policy bypass.

## Plan

1. Trace and write this scoped decision before edits (done); ponytail full read from available repo path because legacy absolute path is unavailable.
2. Reuse residual arithmetic for explicit reviewer acceptance; wire atomic persistence/audit and exact FINAL tax values; update status/error presentation (done).
3. Add regressions to existing wired suites: actual use-case+repository fake transaction, arithmetic/mixed/WHT, permission/source/rate/stale/rollback, tax resolver trust/tolerance and UI contract (done).
4. Run focused API/web/contracts tests and type checks, safe synthetic browser if feasible. Merge latest develop, re-run affected checks, normal push branch and HEAD:develop. No live DB or real accounts.

Open questions: None. Source spec explicitly preserves stricter Tax Code tolerance.
Artifacts: Existing source spec/plan above; this memory; scoped implementation and owned regression suites.
## Verification

- Real `ConfirmExpenseUseCase` + `PrismaExpenseRepository` + expense tax service + tax config/resolver, using an in-memory transactional Prisma fixture: both VAT modes, positive/negative source differences, no-code and configured-tax paths, persisted lines/header/snapshot, FINAL tax component/report contributions, ledger balance and non-claimable VAT cost agree. Repeated confirmation and missing permissions/reason/carrier/version reject.
- Regression fixtures cover discounts, legacy/RATE/AMOUNT WHT, mixed zero/exempt/non-VAT lines, multi-rate selected carrier, invalid/missing/stale source and arithmetic, rate conflicts and overflow. Tax tolerance, missing evidence, locked periods, audit/outbox failure and CAS failure roll back amount changes and successful override audit.
- Relevant expense/API, transaction-tax, tax-event and ledger invariant suites plus existing spec-suite coverage guard: **1,029 passed, 6 skipped, 0 failed** (1,035 total). `DATABASE_URL` and `EXPENSE_PAYMENT_REQUIRE_POSTGRES` unset; six skips are Postgres-dependent expense payment checks. No live database or seeded accounts used.
- Full contracts specs: **202 passed**. Full web specs: **1,183 passed**. Contracts build and full API/web `tsc --noEmit --incremental false` passed before integration.
- Shared `test:item11b-tax` consumers (expense/accounting/procurement/tax/ledger): **364 passed, 14 skipped, 0 failed** before the final trust-boundary test; that additional config-use-case regression passes with its complete 16-test suite.
- Browser skill used on an isolated localhost synthetic fixture rendering the real `ExpenseReviewEditSection`. Verified selectable carrier excludes the exempt line; submitted decision includes reviewed `expectedUpdatedAt`; accepted detail shows original source 8, calculated 7, accepted 8, gross 158 and “ผู้ตรวจยืนยันยอดตามเอกสาร”, without a false blocking mismatch. Synthetic fixture and server removed/stopped afterward. This is component/browser contract verification, not live full-stack E2E.
- Existing review-to-expense-list redirect is unchanged. Mixed VAT and baht WHT regressions remain covered; no duplicate implementation, deployment or historical confirmed-record rewrite.
- Runtime only: reused read-only installed package links and copied schema-matching generated Prisma into this owned worktree; isolated SES 3.1118.0 from `/tmp/mangmee-draft-delete-ses.XMhjOC` (matches lock) resolves missing preinstalled dependency. No dependency manifest, lockfile or schema edits, and no generation through another worktree's package links.

## Integration evidence

- Implementation: `2b46cebb`; merge: `65575487` from `origin/develop` `554ef68e` (includes Checkbill, employee-draft deletion and warehouse-option fixes).
- Only conflict was adjacent new tests in `api-error-message.spec.ts`; retained both VAT and draft-employee regressions. Diff against integrated develop remains 20 scoped files; no upstream behavior removed.
- Post-merge commands below: expense/API/tax-event/ledger + spec guard **1,035 passed / 6 DB skips**; shared tax suite **365 passed / 14 DB skips**; full web **1,195 passed**; contracts **204 passed**. All zero failures. Shared-tax skips are database-dependent accounting close/issue/concurrency scenarios (local PostgreSQL/P27/payment-idempotency fixture unavailable).
- Contracts build, API/web full non-incremental type checks and `git diff --check` passed after integration.
- Review-submit navigation rechecked at `ExpenseReviewPage.tsx:338`: server success precedes `router.replace` to the highlighted expense list; failure stays on the form. No change needed.

Next: Normal push feature branch and HEAD:develop, verify remote SHA, record delivery proof. No deploy.

### Reproduction commands

Run from this branch's worktree root unless a working directory is noted. DB environment is deliberately absent.

```sh
env -u DATABASE_URL -u EXPENSE_PAYMENT_REQUIRE_POSTGRES ./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec $(rg --files apps/api/src/modules/expenses | rg '\.spec\.ts$' | rg -v '\.pg\.spec\.ts$') apps/api/src/modules/tax/domain/logic/transaction-tax.logic.spec.ts apps/api/src/modules/tax/application/use-cases/transaction-tax-config.use-case.spec.ts apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.spec.ts apps/api/src/modules/tax/application/use-cases/sync-tax-events-components.use-case.spec.ts apps/api/src/modules/tax/application/use-cases/sync-tax-events-vat-invariant.use-case.spec.ts apps/api/src/modules/ledger/application/use-cases/journal-vat-invariant.use-case.spec.ts apps/api/src/modules/ledger/domain/logic/transaction-tax-posting.logic.spec.ts apps/api/src/modules/ledger/application/use-cases/template-company-posting.use-case.spec.ts apps/api/src/modules/ledger/application/use-cases/expense-auto-post.use-case.spec.ts apps/api/src/spec-suite-coverage.spec.ts
./apps/api/node_modules/.bin/tsc -p packages/contracts/tsconfig.json
```

- `apps/api`: `env -u DATABASE_URL -u EXPENSE_PAYMENT_REQUIRE_POSTGRES pnpm test:item11b-tax` and `./node_modules/.bin/tsc --noEmit --incremental false`.
- `apps/web`: `../api/node_modules/.bin/tsx --test --test-reporter=spec "src/**/*.spec.ts"` and `./node_modules/.bin/tsc --noEmit --incremental false`.
- `packages/contracts`: `../../apps/api/node_modules/.bin/tsx --test --test-reporter=spec "src/**/*.spec.ts"`.
- `git diff --check`.
