# Agent Memory: Kamal Production script preparation

Status: script and current Production baseline validated; Kamal target unenrolled. No deployment performed.
Owner: Codex
Scope: Prepare the existing Production command using the proven shared UAT controller. Work from main `00cbaa8b98954c068103c012dd6d485d25b1563a` in an isolated worktree; preserve the unrelated billing/Postmark working tree.

## Decisions and implementation plan

- Reuse `infra/kamal/deploy-prod` and `release.py`; no new deployment engine, infrastructure, dependency, or package script.
- Add explicit `--prepare`: target preflight, fresh pinned main, TypeScript/all artifact builds, complete Production config/secret/image validation, native Kamal rendering, and config freshness readback. This mode may run a reviewed local controller and records its hash; actual deployment still requires the main controller.
- Preparation does not acquire a remote lock, publish images, update AgentCore, run DB/catalog writes, roll out containers, change customer access, retire builds, or sign an accepted deployment. A local environment lock still prevents overlap. Existing unresolved operation records remain blocking.
- A successful preparation is `PREPARED_NO_DEPLOYMENT`. It is not deployment acceptance and does not prove future IAM writes, DB migration compatibility, runtime readiness, customer journeys, or elapsed Production rollout time. Apply must recheck/rebuild current main; preparation artifacts are not an implicit promotion input.
- Reject `--prepare --apply` and `--prepare --rollback`. Keep default preflight and UAT behavior unchanged. Production cannot select UAT smoke/browser acceptance or a UAT target/profile by inference.
- Add an explicitly incomplete Production target example and concise operator commands. Never populate it using UAT hosts, credentials, or endpoints, or mark cutover complete without evidence.

## Acceptance and verification plan

- Existing controller, stability, and shutdown tests pass.
- Positive/negative orchestration tests cover preparation phase order, every failure boundary, locks, no mutation calls, argument rejection, wrapper environment sealing, and unchanged apply/default paths.
- Exercise actual Kamal config rendering against synthetic values if the existing local Docker runtime is available. Mark synthetic checks as such.
- Inspect live Production config metadata read-only if an existing non-root principal allows it; do not change IAM or retry denied access to discover failures.
- Record commands, exact results, and remaining enrollment blockers before handoff. Do not claim Production was deployed.

Open questions: No `.env.kamal/production/target.json` is enrolled. Actual Production Kamal hosts, routes, role permissions, signing/acceptance inputs, and approved traffic migration must be established before any apply; Production remains governed by the V2 runbook.
Artifacts: [Production command](../../infra/kamal/deploy-prod), [shared controller](../../infra/kamal/release.py), [operator instructions](../../infra/kamal/README.md), [intentionally incomplete target example](../../infra/kamal/production-target.example.json), [sanitized evidence](../evidence/kamal-prod-preparation-2026-09-13/results.json). Branch `codex/kamal-prod-preparation-20260913`; original billing working tree untouched.

## Verification results

- `python3 infra/kamal/release_test.py`: 23 tests pass, including preparation success/failure, no cloud mutation phases, terminal secret-safe errors, local locks, CLI exclusions, production acceptance boundaries, main pinning and unchanged apply controller checks.
- `python3 infra/kamal/stability_test.py`: 4 tests pass. `python3 infra/kamal/shutdown_test.py`: both actual subprocess shutdown scenarios pass.
- Actual `deploy-prod` CLI: conflicting apply/rollback options, incomplete example and absent enrolled target all reject with the expected nonzero exit; `--help` and shell syntax pass. `git diff --check` passes.
- Existing `build-complete.py` built clean main `00cbaa8b98954c068103c012dd6d485d25b1563a`: TypeScript, DI check, API/web, AI, workers, tools and AgentCore all pass. Total **170.672 seconds (2m50.672s) is build only**, with existing caches; it is neither deployment time nor a complete preparation timer.
- Existing `capture-config.py` captured all three real Production ECS configurations and all 12 current secrets using the existing non-root reader. Secret values remain in private ignored files, never committed or sent to a service. Final metadata read confirms identical configuration hashes and secret versions.
- Existing `release_inventory.py prepare` validated actual images using resolved Production config and Production overrides from main. API/web has 111 explicit config keys, AI 56, workers 19. All required schemas and consistent shared config modules pass. Defaults and absent optional keys are itemized in evidence; this does not claim all optional features enabled.
- All tracked deployment artifacts match source, including 189 migration files and 35 other Prisma/sync files. No DB connection or migration execution occurred.
- Actual Kamal v2.12.0 parsed all three native configs using the complete validated key sets, synthetic Production hosts and synthetic values, with container networking disabled. This is parser proof, not SSH/host/rollout proof. The amd64 tools container also ran successfully under the local ARM host's emulation; Docker emitted a non-failing platform warning.
- Private receipts/logs are retained at `.env.kamal/production/preparation-20260913`; sanitized evidence records their SHA-256 hashes. No live release ID, READY/Production workflow run or signed acceptance result was created.

## Remaining boundary

`--prepare` has **not** run end to end against an enrolled Production Kamal target: that target does not exist. Do not mark `cutoverComplete` true just to pass validation. The separately verified build/config/parser components and mocked orchestration tests do not prove live write permissions, migration compatibility, provider changes, target startup or customer acceptance. Existing Production is still under the V2 protocol until a separately approved migration.

Next: Review/merge this isolated controller change, then establish and verify the actual Production Kamal enrollment and approved migration before using its `--prepare`/`--apply` commands. No live action is implied by this handoff.
