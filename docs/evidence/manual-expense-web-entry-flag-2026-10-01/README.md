# Manual entry flag — local baseline simulation evidence

These are diagnostic artifacts, not application changes or a release candidate. Tests toggle the existing **expenses.manual** key on a disposable local database. During the run the owner chose a separate child flag, **expenses.manual.web_entry**; these results do not certify that unimplemented flag.

- `case-results.json`: 72 counted case/browser variants, 55 passed / 17 failed. Fifteen fail the superseded v1 goal; two existing ON tests have UI expectation mismatches. Pilot and replaced harness errors are excluded from the count.
- `*-results.json` / `results.json`: raw Playwright run reports, including superseded attempts; use case-results for totals.
- `observations-summary.json`: actual ON/OFF statuses, permission sets and key observations, reduced from full response bodies.
- `line-note-pg.json`: four real composed-use-case attempts (ON/OFF and retry), all reproduce the existing invalid-key 400 with zero new expense records.
- `source-before.json`, `source-verification.json`: SHA-256 provenance and verification of 3,728 original apps/packages/e2e files; zero changed/missing.
- `screenshots/`: selected runtime findings. Full traces and HTML report remain in `/tmp/manual-flag-e2e-20261001/evidence` and are temporary; attachment paths in JSON refer to that directory.
- `harness/`: test files/configs and sanitized local environment launcher, copied from the isolated snapshot. They intentionally assert v1 behavior that baseline does not implement and should not be added to normal CI as green acceptance tests.

## Re-run the retained local snapshot

Snapshot: `/tmp/manual-flag-e2e-20261001/repo`. Existing original repo was copied excluding `.env`, build outputs and dependencies; workspace packages were linked to the copied packages and installed external dependencies reused. Config/contracts/API were rebuilt inside the snapshot. Do not run this harness against the user's ordinary development DB.

All task-owned servers/containers were stopped after testing. Containers and snapshot were retained for inspection. Start **only these named containers**, then run API and web in separate terminals:

```sh
docker start manual-flag-e2e-pg-20261001 manual-flag-e2e-s3-20261001 manual-flag-e2e-redis-20261001
cd /tmp/manual-flag-e2e-20261001/repo
python3 ../run.py api node apps/api/dist/manual-flag-e2e/apps/api/src/main.js
```

Web terminal:

```sh
cd /tmp/manual-flag-e2e-20261001/repo/apps/web
python3 ../../../run.py web pnpm exec next dev --webpack -H 127.0.0.1
```

The launcher pins DB `127.0.0.1:25463/manual_flag_e2e`, API3061, web3060, Redis26381, MinIO29003 and synthetic credentials. It does not source `.env`; AI Gateway, email and billing are disabled. MinIO bucket `manual-flag-e2e` is versioned. Initial setup used `prisma migrate deploy`, `prisma/seed.ts`, `prisma/sync-feature-launch-gates.ts` with this launcher; API build used `API_DIST_DIR=dist/manual-flag-e2e`. New empty infrastructure needs the versioned bucket created before the seed stores attachments.

Test commands from snapshot root (run serially; flag state is intentionally shared within the test tenant):

```sh
python3 ../run.py api pnpm exec playwright test -c playwright.manual.config.ts
python3 ../run.py api pnpm exec playwright test -c playwright.extended.config.ts
python3 ../run.py api pnpm exec playwright test -c playwright.webkit.config.ts --grep 'ON manual create|OFF closes direct|OFF upload image'
python3 ../run.py api node line-note-pg-probe.cjs
python3 ../run.py api env S3_E2E=1 EXPENSE_NUMBER_LIVE=1 pnpm exec playwright test -c playwright.on-regression.config.ts --grep 'EXP-INPUT|EXP-0[1-9]|numbered manual|upload staging'
```

The extended harness now includes the two extra focused scenarios, and corrected selectors from later runs. Re-running the whole file produces a different batching layout from the historical raw reports, while testing the same recorded scenarios.

OFF adjacent regression requires the following fixture-only setup; use only the named disposable container:

```sh
docker exec manual-flag-e2e-pg-20261001 psql -U manual_e2e -d manual_flag_e2e -c "UPDATE \"CompanyFeatureEntitlement\" SET enabled=false WHERE \"companyId\"='seed-local-company' AND \"featureKey\"='expenses.manual';"
python3 ../run.py api env RECEIPT_CONTINUITY_TEST_DATABASE_URL='postgresql://manual_e2e:manual_e2e_local@127.0.0.1:25463/manual_flag_e2e?schema=public' pnpm exec playwright test -c playwright.off-regression.config.ts --grep 'REIMB-0[1-5]|originating upload-only'
```

Snapshot-only adjustments to existing test harness: receipt continuity asserts database `manual_flag_e2e` and bucket `manual-flag-e2e`; EXP-01/09 target the confirmed status chip with `^ยืนยันแล้ว(?:\s+\d+)?$` instead of also matching the export button. Original repository tests were not changed. Admin command fixtures materialize a synthetic completed explicit normalization marker; they do not validate the normalizer migration lifecycle.

No screenshots/traces contain customer records: only synthetic seed/test users and local sessions. The diagnostic PostgreSQL databases and storage contain test mutations and should never be used as a source of customer flags or financial data.
