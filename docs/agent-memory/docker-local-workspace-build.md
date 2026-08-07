# Agent Memory: docker-local-workspace-build

Status: Complete
Owner: Codex
Scope: Fix local Docker image builds and startup so `pnpm docker:local` and manual service image builds compile workspace dependencies inside Docker and avoid common host port collisions.

Role gate status:
- BA: Goal is local developer can run full Docker stack after a clean checkout; target users are solo dev/operators; journey is copy env, run `pnpm docker:local`, and web/API/AI/workers images build/start without host `dist`; rules/exceptions are frozen lockfile, repo-root Docker build context, and host ports must avoid common local Postgres/MinIO defaults; acceptance is Docker Compose reaches service health gates and docs explain manual build/run ports.
- SA: Architecture fit is pnpm monorepo plus Turbo task graph and Docker Compose local topology; contracts/config/design-tokens remain workspace packages; no data model, permissions/ABAC, or business state transition impact; scope boundary is Docker build order, local host port defaults, AI Gateway module provider wiring, and docs.
- DEV: Ponytail full read. Smallest correct diff reuses existing `turbo.json` `build` dependency graph, changes local host ports to avoid conflicts, and imports existing `AiModule` into `LineAiModule` for `AiGatewayConfigService`; touched files are service Dockerfiles, AI Gateway module, env example, compose, Docker/spec docs, and this memory; focused local and Docker build/start checks passed.
- Integration: Backend-to-frontend contract remains web importing shared contracts/theme tokens and web depending on healthy API/AI Gateway; UI journey verified by Docker web root HTTP 200; loading/error/permission states unchanged; E2E/browser path not run because stack-level Docker smoke and service health covered this local-run failure.

Decisions:
- Use `pnpm exec turbo run build --filter=<service>` in service Dockerfiles so `^build` dependencies run before deployable service builds.
- Add `packages/design-tokens/package.json` to web deps layer because web declares it as a workspace dependency.
- Use local host ports `15432`, `19000`, and `19001` so `pnpm docker:local` does not collide with common host PostgreSQL/MinIO ports.
- Import `AiModule` in `LineAiModule` because `ErpToolClient` and `LineAiInternalController` depend on exported `AiGatewayConfigService`.
- Keep `pnpm-lock.yaml` generated with repo package manager (`corepack pnpm`, pnpm 9.15.0) so root `pnpm.overrides` stay recorded for Docker `--frozen-lockfile`.

Accepted assumptions:
- Manual image builds run from repo root, matching `infra/docker/README.md`.

Open questions:
- None.

Artifacts:
- `apps/web/Dockerfile`
- `apps/api/Dockerfile`
- `apps/ai-gateway/Dockerfile`
- `apps/workers/Dockerfile`
- `apps/ai-gateway/src/modules/line-ai/line-ai.module.ts`
- `.env` (ignored local file)
- `.env.example`
- `infra/docker/compose.local.yml`
- `infra/docker/README.md`
- `docs/specs/platform-environment-config-spec.md`
- `docs/agent-memory/docker-local-workspace-build.md`

Verification:
- 2026-06-27 rerun: `pnpm docker:local` initially failed before Docker with `[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY]` in Codex wrapper. Direct `docker compose ... config` passed.
- 2026-06-27 rerun: direct `docker compose -f infra/docker/compose.local.yml --env-file .env up --build` initially failed in Docker build with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` because `pnpm-lock.yaml` was missing the root `overrides:` block.
- 2026-06-27 fix: `corepack pnpm install --lockfile-only --no-frozen-lockfile` regenerated `pnpm-lock.yaml` with `overrides: js-yaml 4.2.0, multer 2.2.0, postcss 8.5.10`.
- 2026-06-27 verification: direct `docker compose -f infra/docker/compose.local.yml --env-file .env up --build` passed image build for API, AI Gateway, workers, and web; stack started.
- 2026-06-27 verification: `docker compose -f infra/docker/compose.local.yml --env-file .env up -d` started detached stack.
- 2026-06-27 verification: `docker compose -f infra/docker/compose.local.yml --env-file .env ps` showed api and ai-gateway healthy; postgres and redis healthy; web/workers/minio running.
- 2026-06-27 verification: `curl -fsS http://127.0.0.1:3001/v1/health` returned API `status=ok`, `db=ok`.
- 2026-06-27 verification: `curl -fsS http://127.0.0.1:3002/v1/health` returned AI Gateway `status=ok`.
- `pnpm exec turbo run build --filter=@watchdog-bms/web`: pass; Turbo built `@watchdog-bms/contracts` and `@watchdog-bms/design-tokens` before Next build.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build web`: pass; web image built after in-image `contracts` and `design-tokens` builds.
- `docker compose -f infra/docker/compose.local.yml --env-file .env build api ai-gateway workers`: pass; api and ai-gateway built `contracts`/`config`, workers built `config`.
- `pnpm --filter @watchdog-bms/ai-gateway build`: pass.
- `pnpm --filter @watchdog-bms/ai-gateway test`: pass after rerun outside sandbox; sandbox run failed with `listen EPERM` for the tsx IPC pipe.
- `docker compose -f infra/docker/compose.local.yml --env-file .env up --build -d`: pass; all service images built and stack started.
- `docker compose -f infra/docker/compose.local.yml --env-file .env ps`: pass; api, ai-gateway, postgres, and redis healthy; web/workers/minio running.
- `curl -fsS http://127.0.0.1:3001/v1/health`: pass; API returned status ok and db ok.
- `curl -fsS http://127.0.0.1:3002/v1/health`: pass; AI Gateway returned status ok.
- `curl -fsS -o /tmp/watchdog-web-root.html -w '%{http_code}\n' http://127.0.0.1:3000/`: pass; HTTP 200.
- `curl -fsS -o /tmp/watchdog-minio-root.txt -w '%{http_code}\n' http://127.0.0.1:19000/minio/health/live`: pass; HTTP 200.
- `git diff --check -- apps/web/Dockerfile apps/api/Dockerfile apps/ai-gateway/Dockerfile apps/workers/Dockerfile apps/ai-gateway/src/modules/line-ai/line-ai.module.ts .env.example infra/docker/compose.local.yml infra/docker/README.md docs/specs/platform-environment-config-spec.md docs/agent-memory/docker-local-workspace-build.md`: pass.

Next:
- Manual run path: `pnpm docker:local`.
