# Agent Memory: ci-fast-pr-gate

Status: Implemented on branch `ci/fast-pr-gate`; wall-clock not yet measured on a real PR run.
Owner: repo owner (requested 2026-09-21: pull-request CI ≤ 3 minutes, keep only what cannot be skipped).
Scope: `.github/workflows/ci.yml`, new `.github/workflows/extended-tests.yml`, `recover-release-intent.yml`
fallback step list, `infra/docker/production-image-security.spec.sh`, `apps/api/src/spec-suite-coverage.spec.ts`,
new `packages/typescript-native`, `apps/{api,web}/tsconfig.typecheck.json`.

Baseline (PR run 35551618056, 2026-09-21): ~24 min. Long poles on the 2-vCPU private runner:
Billing Integration backend 23.7 min (one `billing-http-smoke.js` run ≈ 20 min, mostly real 60 s
rate-limit sleeps), Typecheck and Test 21.7 min (`pnpm test` 8.6, `pnpm typecheck` 3.1 — api alone ~3,
image-security spec 2.8, PostgreSQL specs ~3), Billing operations 17, customer 12.

Decisions:
- Pull-request gate keeps: typecheck, every `pnpm test` spec (8 `--test-shard` runners), acceptance runners
  that live outside `pnpm test` (whole-chain, harness, m01, p1, profile/pagination specs), release-recovery,
  fresh-database `migrate deploy`, A5 bootstrap, Nest boot, security audit, secret scan, config validation,
  migration review.
- Release/deploy contract specs (image security, maintenance, legal, LINE AI identity, A5 health) run only when
  a PR touches their inputs (`release_contracts` output of Resolve Source); every non-PR event runs them.
- Moved to `extended-tests.yml` (manual dispatch only — owner runs it on demand; no cron; not a release gate): the three
  billing integration suites and the identity/P27/capture PostgreSQL specs. Deploys reusing a PR run therefore
  no longer carry billing browser evidence.
- api and web typecheck in CI use TypeScript 7.0.2 `--singleThreaded` (api 37–59 s → 15 s locally; multi-threaded
  TS7 was slower on this codebase). Local `pnpm typecheck` is unchanged (TypeScript 5), per the package.json rule.
  TS7 lives in its own workspace package so no Dockerfile installs it and root `tsc` stays 5.9.

Open questions:
- Real CI timing per job; rebalance shard count or move A5/Step 0 if any job exceeds ~2.7 min.
- ci.yml / recover-release-intent.yml are controller files: promote the same blobs to main before the next
  all-target UAT deploy (deploy-uat requires source and caller ci.yml blobs to match).

Verification (local, 2026-09-21):
- actionlint 1.7.12 clean on ci.yml and extended-tests.yml.
- TS7 and TS5.9 both report 0 errors on api and web and the same TS2322/TS2339 for an injected error.
- 8 shards pass; api 9953 tests sharded = 9953 unsharded; other packages match the baseline CI counts.
- production-image-security, agentcore-candidate-policy, fast-selective-workflow, m01-actor-delegation,
  production-readiness-workflow-v2, production-deploy-workflow-v2 specs and Kamal unittests pass.
- spec-suite-coverage passes with extended-tests.yml as an owned runner.
- Dockerfile-style install (api manifests only) succeeds with the new lockfile and does not fetch TypeScript 7.

Next: open a PR to develop, read per-job durations, rebalance; then promote controller files to main.
