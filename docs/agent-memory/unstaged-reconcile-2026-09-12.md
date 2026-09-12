# Agent Memory: Unstaged reconciliation 2026-09-12

Status: Local application acceptance passed; PR554 awaiting CI and integration. No deployment authorized in this task.
Owner: Codex, at owner request to discard incorporated work and validate missing changes before merging develop/main.
Scope: 759 original dirty paths (95 tracked, 664 untracked), compared with main e5df1709cc11e235dc4a17f0d0fced32860161d5 and develop 325454714e33e2761dce7576b86a509c9c28519b, whose trees match.

## Decisions

- Preserve a verified private archive of every original path before cleanup. Do not commit customer exports, scratch outputs, credentials, or obsolete infrastructure prototypes.
- Retain current main receipt/expense implementations, including subsequent security, typing, PDF and UI fixes. The local checkpoint ledger records their earlier integration through PRs 506–519.
- Integrate only missing billing recovery and LINE entry behavior. Existing specs/plans and docs/evidence/stripe-repair-2026-09-11 cover this scope; its runtime was preserved on 2d52b4b2 after the previous delivery was clarified as docs-only (PRs 547/548 closed, 549/550 merged).
- Preserve main changes during three-way reconciliation. No package manifests, cloud resources or deployment settings change.
- Acceptance: term expiry recovery permits notice/legal/session paths without business access; admin/security holds and tenant/role restrictions stay enforced; renewal/sweep/audit/notification writes serialize and replay safely; selected-company errors and LINE handoff are explicit and retain context.
- No Stripe provider integration or real LINE-provider acceptance is claimed. Local browser payment outcome invokes the existing manual admin renewal route.

## Verification

- Current candidate: full workspace pnpm typecheck passed.
- Current candidate: focused node/tsx tests: 727 passed, 0 failed/skipped/cancelled (110 suites).
- Current candidate: real PostgreSQL concurrency/crash/replay checks: 15 passed, 0 failed.
- Browser attempt 1: 28 passed, 2 failed because the invocation omitted documented local LINE_WEB_HANDOFF_ENABLED=true and dummy LINE_LIFF_ID. Application source unchanged.
- After owner pause/resume, attempt 2 could not read PostgreSQL because local Docker was stopped; 30 fixture failures (customer access correctly closed), not 30 distinct product defects. Restart only the existing local PostgreSQL/Redis containers before repeating; no database reset or gate override.
- Real local sibling marketing bundle: 22 passed, no external POST delivery; no sibling source changed.
- Final browser check: 30 passed, 0 failed/skipped/flaky; actual browser/BFF/API/PostgreSQL. Same candidate source, documented local LINE flags, existing local DB/Redis healthy.

## Artifacts

Private audit directory: .env.kamal/uat/unstaged-audit-20260912/ (ignored). Includes inventory.json, verified initial-files.tar.gz, three-way comparison results and actual check logs. Original workspace remains untouched until final verification and merge. Sanitized results and tested source hashes: docs/evidence/unstaged-reconcile-2026-09-12/results.json.

Open questions: None.
Next: Finish database/browser checks and per-path disposition; merge verified code, then clean original workspace using exact-path/hash checks while retaining unique artifacts privately.

## Per-path disposition

- 43 original paths: missing runtime/tests, integrated into the reviewed candidate. One additional existing acceptance catalog line includes the new LIFF test; reused from retained billing branch 2d52b4b2.
- 155 exact duplicates plus 9 fully incorporated changes: discard from original workspace after branch integration.
- 20 superseded app/contract files and 4 old controller files: keep the newer main implementations.
- 528 historical documents/evidence, local prototypes and generated/export files: preserve privately with original hashes rather than assert unverified historical state or publish exports. This is archival, not deletion of the only copy.
- All 759 original paths have exact-byte archive coverage. Private disposition.json records every path, hash and reason. Original branch and its four commits absent by identity from main will remain retained; no branch history is reset.

## Reproduce browser acceptance

Use the existing seeded loopback PostgreSQL URL in DATABASE_URL (never reset a shared database), Redis on 127.0.0.1:6379, and free API/WEB ports 3031/3030. Pass E2E_API_BASE_URL=http://127.0.0.1:3031/v1, E2E_WEB_BASE_URL=http://127.0.0.1:3030, API_PORT=3031, WEB_PORT=3030, NEXT_DIST_DIR=.next/unstaged-3030, MODEL_PROVIDER=disabled, LINE_WEB_HANDOFF_ENABLED=true and LINE_LIFF_ID=1234567890-test. Then run `pnpm exec playwright test e2e/plan-term-billing-readiness.spec.ts --project=chromium --workers=1 --retries=0 --timeout=90000`. The dummy LINE value is used with intercepted provider boundaries. Restore only generated next-env.d.ts after the run.

## Integration checkpoint

- PR554: https://github.com/MangmeeDev/mangmeeplus/pull/554. Initial source commit df0f91e77e23591fd265affdf636f33b99309602.
- CI34676972716 stopped in Resolve Source because six reviewed auth/layout files had stale maintenance SHA-256 pins. Other CI jobs were skipped; this run is not application validation.
- Ran the existing `sync-production-maintenance-release-pins.mjs`; only six exact-file hashes and the enclosing validator hash changed. Maintenance pin-sync/validator regression suites pass. No maintenance policy, workflow steps or customer gate state changed.
- SWC DI metadata check passes: 813 files, 874 decorated classes, 824 with constructor dependencies.
- Full workspace `pnpm test` passed, exit 0 in 45.210s (API/web/AI/workers/config/contracts). This overlaps the focused counts and is not counted as extra unique cases.
- A merge-tree rehearsal of origin/develop into the candidate produces exactly the candidate tree. Include that existing develop ancestry so develop can fast-forward to the eventual accepted main merge without duplicate code validation.
- Original dirty workspace is still untouched. 528 historical/local-material files are additionally copied into the private retained-local-material directory with per-file hash verification.
