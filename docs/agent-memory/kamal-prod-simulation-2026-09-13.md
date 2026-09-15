# Agent Memory: Production deployment simulation

Status: isolated AWS core rehearsal passed once on exact main; full Production acceptance is NOT proved. Dev and both UAT hosts verified stopped at 2026-09-14 00:41:22 UTC; temporary SSH rule removed. See latest execution below; earlier waiting states are historical.
Owner: Codex
Scope: Owner explicitly requested inspection of Production environment/hosts/configuration and a real isolated rehearsal using the UAT method. This authorizes the rehearsal and its isolated setup, not customer traffic cutover or mutation of live Production data/services.

## Decisions and current evidence

- Continue from `bc984cae` in `codex/kamal-prod-preparation-20260913`; preserve the unrelated billing/Postmark working tree.
- Read the cloud operations and deployment protocols before AWS work. Reuse existing controller/build/config/catalog/native helpers; do not relax Production target/acceptance guards to obtain a passing receipt.
- Fresh EC2 inventory: both UAT hosts and the dedicated Dev host are stopped; the existing bastion is running. Previous UAT IPs are no longer assigned. No Production Kamal host/target exists.
- Fresh Production ECS config capture passes for all three services and 12 current secret references. Values remain private.
- Fresh Production RDS read: PostgreSQL **18.3**, `db.t4g.small`, Multi-AZ, encrypted/private, 35-day backup and deletion protection. A local PostgreSQL 15/16 test cannot be presented as matching this engine.
- Existing non-root CLI principals: `watchdog-bedrock`/`watchdog-bedrock-dev` identify the same deployment user; `mangmee-kamal-uat` assumes the scoped UAT deploy role. `thawatchai` session is unavailable.
- Historical CLI denials: Dev StartInstances dry-run, CloudFormation template/list, IAM policy/simulation, and Production Redis discovery. Root Console restored by owner resolves the inspection barrier, not the non-root deploy permissions.
- Owner restored Console in Chrome tab `325830887` and explicitly authorized root for this isolated task, with immediate host shutdown after tests. The workstation IP changed; Dev SG permits the previous operator /32. Exact temporary SSH add/remove payloads are prepared privately. Browser policy requires action-time confirmation for new security-sensitive access, so a precise question is pending; no rule or host state changed.

## Execution plan and acceptance

1. Capture actual Production configuration/infrastructure evidence and classify every rehearsal difference, especially engine/TLS, roles, endpoints and feature configuration.
2. Run the real source/artifact and database migration/sync checks on an isolated empty PostgreSQL matching Production's engine, with no network path to Production and no customer data. Preserve every result; never relabel this as cloud deployment.
3. Once a usable cloud session exists, inspect the exact role/resource capabilities and prepare a concrete isolated host/network/registry/provider/database target using existing UAT patterns. Do not copy production credentials to a running test workload or invent cutover completion. Review all prerequisites together before one live rehearsal invocation.
4. Exercise build/publish/pull, provider preparation, DB/catalog, native rollout/readback, complete config, deep API/AI/workers readiness and acceptance using the isolated target. Record the exact source, image/config hashes, operation and complete clock. Cloud engine/HA/permissions differences remain explicit.
5. Reconcile any unknown outcome before retry. A complete rehearsal requires actual boundary evidence; mocked tests and a local database run alone are insufficient. Keep setup time separate and include all deploy phases in the reported deploy clock.

Open questions: None for completed core rehearsal. Owner granted temporary SSH approval; rule removed after completion. Full provider/Production enrollment remains unproved, with no broad IAM expansion authorized.
Artifacts: Private evidence under `.env.kamal/production/simulation-20260913`; source/controller worktree is `.env.kamal/production/preparation-20260913/source`.
Verification: See completed evidence below. The full Production deploy has not been executed or timed.
Next: Keep Dev stopped. Review the full-rehearsal gaps below before any new live action: dedicated provider spare/callback, Production host/role/route enrollment and customer OPEN/signing. No automatic Production promotion or claim that this single synthetic-core measurement is a stable/full Production time.

## Completed isolated execution

- Added [rehearse-database.py](../../infra/kamal/rehearse-database.py), reusing the actual `Release.migrations`, `Release.deep_health`, `inspect_container`, and candidate-image config validators. Shared production controller files remain byte-identical to the previously tested `bc984cae` controller. Current main is still `00cbaa8b98954c068103c012dd6d485d25b1563a`.
- Fresh Production configuration and secret metadata still match the baseline validated during script preparation. Runtime simulation reads only configuration and secret reference names, generates fresh random credentials, replaces data routes with isolated dependencies, and has no external network route, host ports or AWS credentials. It does not load Production secret values into workloads.
- Actual RDS engine is PostgreSQL 18.3. Used official local PostgreSQL 18.3, bootstrapped the migration catalog of the ECS-advertised source `fc2838c4cb691033f41595c0d43587f10377d33c`, then executed the unchanged controller's DB sequence against the exact current tools image.
- Source-based fixture has 182 applied migrations and 6 pending relative to main's 188. Hotfix correctly refuses before upgrade. Actual normal precheck/safety/migration/sync/authority sequence passes, followed by another actual hotfix sequence with `EXACT_MATCH`. This is not the actual Production applied ledger or customer-data migration proof.
- First DB component run `postgres-upgrade-01` passed and cleaned up. First container run `runtime-01` passed final health but is **not accepted as stable**: 14 workers startup 502 errors exposed a harness sequencing mistake. It started all containers before probing readiness; `Release.deploy` waits per service. Original receipt/logs remain unchanged, with an adjacent disqualifying assessment.
- Fixed the harness to wait for each service's deep health in the same AI → API → workers order as `Release.deploy`; added a runtime log error gate. `runtime-02` passed full image/environment readback for all three services, production config validation, API database readiness, workers' Redis PING and authenticated internal API readiness, AI health, frontend login HTML, and zero structured runtime error events. Text review found only a successful scan with `failed: 0`.
- All test containers/networks removed; existing development work and stopped AWS hosts untouched. Both simulation commands exit 0 after verifying their own cleanup. Python syntax and `git diff --check` pass. No new required CI/deploy workflows dispatched.
- [Sanitized results and explicit limitations](../evidence/kamal-prod-simulation-2026-09-13/results.json) retain component timing boundaries, runtime hashes, metadata continuity, the rejected first runtime attempt, and SHA-256 hashes of private logs. These component times exclude the earlier build and every cloud deploy stage; no number is a full Production deploy time.

## Remaining parity gaps

Latest AWS run proves ECR publication/pull and native single-host Kamal SSH/proxy rollout. Isolated AgentCore update/readback, Production role/write permissions and customer acceptance remain unproved for this candidate. Dev is a single host with UAT-only runtime permissions, not Production multi-AZ enrollment. Local Redis is **7.4.10**, while actual Production is managed **7.1.0**, two nodes, TLS/authentication and automatic failover. The latest local test uses DB/cache TLS with a disposable CA, not the AWS certificate chain or managed HA. Workloads use synthetic integration credentials with outbound access blocked. Storage, antivirus, real LINE/AI/email and authenticated/customer OPEN acceptance were not tested. API/AI/worker startup readiness does not establish these journeys.

## Additional execution after owner restored root Console

- Root readback established actual Redis engine 7.1.0 and encryption/authentication/failover; existing Dev/UAT role policies are restricted to their non-production resources. No IAM policy was changed.
- Added `--tls` to the same isolated harness. `runtime-tls-01` passed: PostgreSQL 18.3, actual Prisma adapter connection reports TLS 1.3, normal migration/sync/authority and subsequent hotfix pass, all three actual images/configs/readiness pass, authenticated Redis over TLS works, zero structured error events, frontend responds. Containers/network removed. **85.575 seconds includes local setup and cleanup only; it excludes build and every cloud deployment phase.**
- Read Production via the existing `AWS-StartInteractiveCommand` support path, using IAM-authenticated `watchdog_support_ro`, `verify-full`, `default_transaction_read_only=on`, 15s statement/2s lock timeouts. No customer rows or Production credentials were copied. Session `root-l5tdyxu2594req3e72dhhl6lze` returned the SQL result at `2026-09-13T16:05:09.040227Z`; later AWS history verified **Terminated**, not active. CLI exited 0 and printed an EOF after the SQL row; retained explicitly rather than calling the entire transport error-free.
- Live catalog: **182 applied, 0 unfinished**, ordered-name/SQL-checksum fingerprint `40a5a8ba0eca164cb736de7a17368c9a` exactly matches baseline source `fc2838c4...`. Main `00cbaa8b...` has **188**, fingerprint `01316c8aba6362d388b08bc9cd4241da`. Thus all six pending migrations in the local baseline are now corroborated by the actual live ledger. The first release needs normal mode; hotfix correctly refuses it. This remains an empty-data rehearsal, not a Production data clone or DDL execution.
- Fresh read-only AWS and all timing/evidence hashes are in `docs/evidence/kamal-prod-simulation-2026-09-13/results.json`. No UAT, READY, or Production workflow was dispatched; run IDs are not applicable. No simulation instance has been started by this task.

Final verification at 16:10:21.995721 UTC: dedicated Dev and both UAT instances are stopped; no task-owned Docker container or network remains. TLS runtime log text review matched only info-level entitlement-exceptions route names, not failures. Python syntax and git diff whitespace checks pass. Temporary SSH approval remains unanswered; do not start the host or apply that rule before it arrives.

## 2026-09-14 authorized cloud execution

Owner approved the exact temporary SSH rule. Workstation IP still matches the approved /32. Root Console added only `sgr-0a12dbd8f66e96575` to Dev SG, then started `i-0883f1ff88440ca07` at 00:02:44.332641 UTC. Fresh IP `56.10.12.84` passed the original enrolled SSH key. Existing proxy v0.9.2, Docker29.1.3, Python3.12.3 and 44GB free; explicit non-root `deploy-uat` read-only preflight passed in14.7s (`20260914T000541Z-de1e3d71`). Host shutdown failsafe is scheduled01:04:26 UTC; do not rely on it instead of immediate shutdown.

Run `infra/kamal/rehearse-cloud.py` only on this exact Dev enrollment. It reuses actual Release build/config/publish/migrations/native rollout/readback, captures fresh Production config but replaces every secret/external data route, uses PostgreSQL18.3 and TLS with an isolated baseline whose catalog matches actual Production. Every new secret reference is verified replaced before transfer. Native CA mounts are test-only; external providers, customer acceptance and Production topology/roles remain explicitly unproved. The controller’s Production guards are unchanged. Setup/boot/baseline initialization is kept outside the deploy clock. The script powers off this host in finally on success/failure; root Console must remove only the temporary rule and verify stopped status afterward. No Production release is authorized by this rehearsal.

First cloud operation `20260914T001658Z-a1f78642` failed during fixture setup before the deploy clock or main build started. PostgreSQL18.3 and all182 baseline migrations passed with the live catalog fingerprint. Redis restarted because official entrypoint changes UID0 to redis999, while `/proof/redis.conf` was owner-only UID1000. Script powered off the host; AWS verified stopped. Root reopened only Dev for bounded diagnosis, new pinned-key IP47.129.159.150. Preserved the original result and failure logs. Fixed the synthetic Redis container to run non-root UID1000:1000 with its own private writable data volume; actual Linux proof: authenticated TLS PONG, SAVE succeeded, restartCount0, config/key both0600. Added dependency TLS readiness and automatic failure-log capture. This is fixture setup, not a production release defect or a successful deploy. Re-read mandatory retry protocol, reconciled the prior fixture/lock, and start one fresh cloud operation. The original temporary SSH rule remains part of this same ongoing authorized rehearsal and must be removed at completion.

## Completed AWS core rehearsal — 2026-09-14

Operation `20260914T003123Z-1f9c690a` exited 0 once with
`PASSED_ISOLATED_CLOUD_CORE_REHEARSAL_NOT_PRODUCTION_ACCEPTANCE`. Fresh main remained
`00cbaa8b98954c068103c012dd6d485d25b1563a`. No repairs/retries occurred inside this deploy clock.
Previous failed setup is retained above and in the evidence; this is not repeated stable-run proof.

| Observed phase | Seconds |
| --- | ---: |
| Fresh main, dependencies/contracts/Prisma, TypeScript, four images and AgentCore package | 57.714 |
| Fresh Production config, synthetic substitution, candidate validation and native render | 13.048 |
| Four real ECR publications/digest readback and target pulls | 256.314 |
| Production config/secret-version freshness before mutation | 4.027 |
| Actual normal migrations, sync and source/feature authority | 68.652 |
| Native AI → API → workers rollout, full image/env/proxy readback and readiness | 84.968 |
| Final readiness, frontend and runtime error scan | 23.062 |
| Phase boundaries/bookkeeping | 0.012 |
| Main fetch through final core proof | **507.797 (8m27.797s)** |
| Lock cleanup and immediate shutdown request | 2.980 |
| Deploy clock through command exit | **510.777 (8m30.777s)** |
| Earlier target/fixture baseline setup | 59.023 |
| Whole successful command including setup/shutdown request | **569.800 (9m29.800s)** |

Build reused cache. TypeScript itself ran and passed in36.043s; overlapping build subphases must
not be added to the parent57.714s a second time. These are observations, not constants or an SLA.
Wall time from successful command start to final AWS stopped/rule-absence readback was598.933s
(9m58.933s). Entire cloud activity from initial host start00:02:44.332641 to final readback00:41:22.152660
was2317.820s (38m37.820s), including preparation, failed setup, stopped interval and diagnosis.

All three candidate images and complete environments matched the manifest: API113, AI58, workers21
keys (each count includes two test-only CA/metadata settings). PostgreSQL18.3 baseline catalog
matched the actual Production182 migration ledger; normal sequence upgraded it to current main.
Deep health passed API/DB, AI and workers/Redis/authenticated internal API. Native proxy serves the
verified candidate, and frontend HTML responds. Zero structured runtime errors; broad log review
found only info-level exception-route names and successful jobs with failed:0. Four artifact digests,
controller/source/config hashes, phase receipts and private-log hashes are retained in sanitized evidence.

**Limit:** This is actual shared core execution on one isolated Dev with synthetic credentials/data.
Customer gate observed HTTP200 / `CLOSED`; provider update/acceptance, launch retirement, customer
OPEN/signing, public HTTPS source binding, actual Production roles/network/HA and external business
journeys were not exercised. Existing Dev AgentCore endpoint still advertises old07824efc source; no
dedicated spare exists (the other candidate endpoint belongs to UAT and was not touched). Redis test
version7.4.10 differs from managed Production7.1.0. Full Production deploy time remains null.
The first Production candidate has six unapplied migrations and must use normal mode.

Script requested shutdown immediately at the end. Root AWS readback at00:41:22.152660 UTC confirms
Dev `i-0883f1ff88440ca07` and both UAT hosts **stopped**, and temporary
`sgr-0a12dbd8f66e96575` **absent**. Existing SSH rules and Production bastion/services are preserved.
Private synthetic fixtures/images remain on the stopped Dev volume for evidence; they are not a
serving environment. No UAT/READY/Production Actions workflows dispatched (run IDs not applicable).

Read-only controller audit also identifies checks still needed before declaring Production ready:
verify enrolled IAM profiles rather than mere profile existence; verify intended CPU/memory limits;
and bind public route acceptance to the exact source, not only local candidate/proxy checks plus a
manual cutover flag. No shared controller guard was altered as part of this rehearsal.

Final local verification: both rehearsal scripts parse; `git diff --check` passes; exact executed cloud harness hash matches retained receipt; phase arithmetic, status, explicit null full-Production time and cleanup assertions pass. Shared Release/wrappers/config/inventory helper remain byte-identical to bc984cae. Scoped changes remain uncommitted in the preparation worktree; unrelated billing/Postmark checkout is preserved.

## Publication request — 2026-09-14

Owner explicitly requested commit, push and merge into main and developer; verified remote branch is `develop` (no `developer` branch). Publish only the Production preparation and isolated rehearsal work from this worktree. Fresh main/develop still match the reviewed baseline; no unrelated feature files or package.json changes are included. Existing owner authorization permits admin merge. Before publication: 23 controller tests pass, JSON/Python syntax and whitespace checks pass, and all proposed files were compared privately against resolved Production secret values with no matches. Only sanitized evidence is tracked. GitHub pull-request merge records provide the resulting commit/PR identifiers. This request does not dispatch a live UAT/Production deployment.
