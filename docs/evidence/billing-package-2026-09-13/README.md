# Paid-package quota implementation evidence — 2026-09-13

Status: **LOCAL SLICE PASS; full delivery IN PROGRESS**. Exact source hashes and run summaries are in [receipt.json](receipt.json). Code is uncommitted WIP; evidence is not an accepted release or a claim that Stripe/LINE/browser flows work end to end.

## Verified

- New paid grant integration: **8 node tests PASS**, seven scenario groups plus wrapper, real isolated PostgreSQL. Executes the internal financial-apply seam and production OCR admission/release, with 1,200 actual annual admissions across web/LINE route identities; no OCR model, external LINE delivery, Stripe charge or browser involved.
- Covers source replay/concurrent apply, changed evidence/tenant rejection, annual use beyond monthly equivalent, no calendar reset, last-slot concurrency, bank-statement exclusion, exact failed-admission compensation, full-package repeat with immediate units/future service and retained usage, apply rollback/deadlock race, holds/expiry, compound foreign-key company isolation and legacy trial15.
- Existing OCR regression with PostgreSQL: **65 PASS / 0 skip**. Earlier combined package/LINE/OCR regression: **340 PASS / 2 skips** (its two optional PG checks lacked DATABASE_URL; both were subsequently executed in the 65-pass run). These runs overlap; do not add counts as distinct cases.
- Package formula plus suite inventory: **8 PASS** (five package cases and three inventory checks). Acceptance runner catalog: **4 PASS**. Contracts compile, API typecheck, API SWC build and CI YAML parse pass. New tests are registered without package.json edits; GitHub CI has not run.

## Reproduce

Use a migrated, disposable local PostgreSQL database named `mangmee_billing_20260912` or the CI-owned `watchdog_postmark_ci`. Keep credentials outside source/logs. Run from `apps/api` using the existing toolchain:

```sh
corepack pnpm exec tsx --tsconfig tsconfig.json --test src/modules/billing/billing-receipts.pg.spec.ts
corepack pnpm exec tsx --tsconfig tsconfig.json --test src/modules/billing/domain/billing-package.spec.ts src/spec-suite-coverage.spec.ts
corepack pnpm exec tsx --tsconfig tsconfig.json --test src/modules/line-ai/application/company-ai-usage-meter.spec.ts
```

The paid integration reads `BILLING_TEST_DATABASE_URL`; legacy OCR uses `DATABASE_URL` with `OCR_REQUIRE_POSTGRES=true`. Missing env skips optional integration and is not a PASS. The new integration removes its own fixtures. Local migration `20260913100000_billing_receipt_grants` is additive; unrelated baseline schema drift detected by diff generation was excluded before migration. No application deployment or customer database change.

## Remaining

Provider payment/scheduling for repeat package purchase, all-prepaid-time monetary upgrade, scheduled downgrade/caps, grace, operator controls/recovery, API/BFF/customer/admin UI and full web/LINE/Stripe sandbox/native acceptance remain incomplete. Billing services are still unbound WIP. No commit/push/merge/deployment was performed.

Receipt-only purchase is a separate **DRAFT proposal** from the latest discussion, with no approved commercial price/expiry/activation. Confirmed full-package repeat formula remains: whole quota now, full purchased interval appended to old paid expiry; retain usable prior balance.
