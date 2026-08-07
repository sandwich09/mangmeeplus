# Agent Memory: H-13 dist-only production image

Status: Complete. CI-manifest live deployment, exact-commit release task, production verification, exposed `DATABASE_URL` rotation, and retirement of all three compromised `49d0132f` ECR digests are complete; H-13 is checked.
Owner: Platform/Security release owner for live closure.
Scope: Production Docker build contexts and final stages for API, combined API/Web, Web, Lambda Web, AI Gateway, and Workers; ECS/App Runner deploy scripts; CI image scan/SBOM; Docker/production runbooks.
Decisions:
- GitHub `production` uses exact deployment policies for branch `develop` and tags `release-*`. AWS OIDC trust is scoped to `repo:MangmeeDev/mangmeeplus:environment:production`; no long-lived AWS access key is stored in GitHub.
- Production publication is manual or `release-*` only. Its pinned-action matrix pushes only the three active ECS repositories, pulls each returned digest, verifies the final filesystem and OCI revision, generates an SPDX JSON SBOM from that digest, and aggregates the exact `repository@digest` values into one 90-day release artifact.
- Production deploy pins the current full commit (independent of workstation `.env`) and builds it through `git archive`; dirty, ignored, and untracked workstation files cannot enter the context. Images carry `org.opencontainers.image.revision` and deploy scripts resolve ECR tags to immutable digests.
- Docker build stages use explicit source inputs. Runtime stages copy only compiled API/AI/Worker output, Next standalone/static/public output, and production/no-optional dependency graphs.
- Final filesystem gates reject nested `.env`, application TypeScript, source maps, compiled specs/smokes, application markdown, Prisma CLI, `tsx`, TypeScript, SWC, and Turbo. CI generates an SPDX JSON SBOM for each final image.
- Production API startup no longer executes migrations, permission/address sync, seed, or system-admin reset. Those are release-task responsibilities; API deploy scripts fail closed unless `RELEASE_TASKS_APPLIED_SHA` matches the exact 12-character deployment SHA. Local Compose keeps the existing tooling-bearing `local` API target.
- ECS Express accepts `PRODUCTION_IMAGE_MANIFEST` only after validating the exact AWS account/region registry, three service/repository mappings, full source commit, and digest-bound image refs. Manifest mode skips workstation Docker build/push and binds `RELEASE_TASKS_APPLIED_SHA` to the artifact source commit.
- The only credential key present in the old `49d0132f` API image `.env` was `DATABASE_URL`. Its RDS master password and Secrets Manager version were rotated; JWT, LINE, encryption keys, and user sessions were not rotated without evidence.
- The current ECR residual is temporarily accepted for this authorized rollout: the same three Critical/five High/three Medium findings exist on each Linux/amd64 manifest in Debian essential Perl/util-linux packages. Rebuild when Debian publishes fixed packages.
- `SEED_SYSTEM_ADMIN_PASSWORD` is no longer written/injected by combined ECS/App Runner deployment. The existing live secret/credential is not deleted or rotated by this code-only task.
Open questions:
- Rebuild when Debian publishes fixed Perl/util-linux packages; do not remove essential packages from the runtime blindly.
Artifacts:
- `.dockerignore`
- `.github/workflows/ci.yml`
- `apps/{api,web,ai-gateway,workers}/Dockerfile*`
- `infra/prod-app-runner/Dockerfile.api-web`
- `infra/docker/build-clean-production-image.sh`
- `infra/docker/validate-production-manifest.sh`
- `infra/docker/verify-production-image.sh`
- `infra/docker/production-image-security.spec.sh`
- `infra/prod-app-runner/start-api-web-runtime.sh`
- ECS/App Runner deployment scripts and Docker/production docs.
Verification:
- GitHub Actions manual run `29693839618` passed all gates and publishers at commit `6d66bdc762990cad6ee7e716dd20448fe2d5e3c4`. Artifact `production-release-6d66bdc762990cad6ee7e716dd20448fe2d5e3c4` (id `8444448748`, expiry `2026-10-17`) was downloaded and revalidated with its three SPDX SBOMs.
- Final CI index digests: API/Web `8516af4a1726…`, AI Gateway `1e2c41648c87…`, Workers `2fe1cec78e4e…`; ECR Linux/amd64 child scans completed at Critical 3/High 5/Medium 3 each.
- Release task `watchdog-bms-release-task:3` pinned clean-archive digest `7667c8732972…`, ran as `node` with only `DATABASE_URL` and no task role, and stopped with exit `0`: 70 migrations/no pending, permission sync 321/12/1225/0 revoked, Thai Address 7436/7436.
- Old `49d0132f` API image inspection exposed only the key name `DATABASE_URL` (no value was printed). RDS master user/secret matched; password reset completed with no pending modification and Secrets Manager created current version `dd3e3246-2dec-4721-a984-9e0a0f6d930a`. A post-rotation release task using `AWSCURRENT` exited `0`.
- Active ECS revisions and the sole running task per service pin the three CI manifest digests and `GIT_SHA=6d66bdc76299`. Old pre-rotation API/Workers tasks were explicitly stopped after ECS Express retained them during drain. API/AWS and public-domain health repeatedly returned DB `ok`; AI Gateway and Workers returned `ok`; exact new API/AI streams had zero error-like events and Workers had no new error after `2026-07-19T16:23:00Z` (its earlier retries hit the draining old API task).
- After the initial `AccessDenied`, the operator granted the scoped delete permission. Exact compromised API `19255401…`, AI `4fb5b8f1…`, and Workers `1a361858…` digests were deleted with no failures; three exact `batch-get-image` checks returned `ImageNotFound`. Dist-only `84ba45b8` remains the rollback artifact.
- Post-cleanup ECS Express verification: all three services remained `ACTIVE`, pinned CI digests API/Web `8516af4a…`, AI Gateway `1e2c4164…`, Workers `2fe1cec7…`, and reported `GIT_SHA=6d66bdc76299`; API health returned DB `ok`, and AI Gateway/Workers returned `ok`.
- Manifest deploy gate: shell syntax, valid three-service fixture, wrong-account rejection, production image security spec, and `git diff --check` passed.
- GitHub Actions manual run `29693002687` passed all release gates and all three pinned-action publisher jobs. Final artifact `production-release-e655893f6c177a8515b16db2788335e3cd2592f5` (artifact id `8444212192`, expiry `2026-10-17`) was downloaded and revalidated: manifest source/run binding passed and all three SBOMs are valid SPDX JSON.
- CI manifest digests match ECR tag `git-e655893f6c177a8515b16db2788335e3cd2592f5`: API/Web `1429498f4c44…`, AI Gateway `cf292f96dc85…`, Workers `f5cdab009223…`. ECR scan completed on their Linux/amd64 child manifests with Critical 3/High 5/Medium 3 each.
- Local release-publisher checks: CI YAML parse, static production publication assertions, updated production-config fixture 13/13, explicit contracts build and Prisma generation for clean CI typecheck, workspace typecheck, full workspace tests (API 2166/2166), and `git diff --check` passed.
- AWS role `arn:aws:iam::311414082667:role/watchdog-bms-ci-production` trust policy uses exact `aud=sts.amazonaws.com` and the production-environment subject. GitHub environment variables hold only the non-secret role ARN, region, and account ID; the pinned OIDC action performs an account-bound smoke check before ECR/deploy permissions are added.
- GitHub Actions run `29692097653`, job `AWS OIDC`: pass at commit `c7c2c14f`; temporary credentials were issued and the account-bound identity check passed. The same run exposed an existing CI setup conflict between `version: 9` and root `packageManager: pnpm@9.15.0`; the redundant workflow version was removed so the committed package-manager pin remains authoritative.
- `bash infra/docker/production-image-security.spec.sh`: pass; adversarial `.env`, source, source-map, smoke/admin, and dev-tool fixtures rejected.
- Production dependency graphs for API, AI Gateway, and Workers installed with `--prod --no-optional`: pass; no Prisma/tsx/TypeScript/SWC/Turbo packages or bins; Prisma client runtime imports passed.
- Isolated Git-tree Docker builds + exported-filesystem gates: API/Web, API, Web, Lambda Web, AI Gateway, and Workers passed. Combined image gate first rejected Next source maps, then passed after artifact cleanup.
- Runtime smoke from dist-only images: combined API/Web `/v1/health`, AI Gateway `/v1/health`, and Workers `/health` returned HTTP 200.
- Clean committed-context helper built from an isolated commit, passed the filesystem gate, and its OCI revision label exactly matched the source commit.
- Final focused checks: security spec, shell syntax, CI YAML parse, local Compose config, executable modes, and scoped `git diff --check` passed.
- Lambda Web clean-snapshot build (including the pinned Lambda Adapter base) and exported-filesystem gate: pass.
- First release-task revision stopped with exit `1` before migration because the local target omitted `prisma.config.ts`. Commit `84ba45b8` added the explicit copy plus regression gate; rebuilt image loaded the Prisma config and passed `prisma validate` without a DB connection.
- Release task `watchdog-bms-release-task:2` used image digest `ed199afe…`, user `node`, only `DATABASE_URL`, and no task role; it stopped with exit `0` after 70 migrations/no pending, permission sync 321 permissions/12 roles/1225 grants/0 stale revoked, and Thai Address 7436/7436.
- Manual clean-archive deploy pinned active digests API/Web `2ba76ca1…`, AI Gateway `bdb63c78…`, Workers `0cae8d89…`. Exact pulled digests passed the filesystem allowlist and carried full OCI revision `84ba45b8cc7e38990f451f08d6f610fe1bdcfa7b`.
- ECS completed at desired/running/pending `1/1/0` with zero failed tasks; old `49d0132f` tasks were drained/stopped. Post-bake health passed for API/Web (DB `ok`), AI Gateway, and Workers; rollout log filter found no error/fatal events. API active config no longer injects `SEED_SYSTEM_ADMIN_PASSWORD`.
Next: Remove the temporary operator `ecr:BatchDeleteImage` permission if it is not an ongoing operational requirement, and rebuild the CI images when Debian publishes fixes for the accepted Perl/util-linux residuals.
