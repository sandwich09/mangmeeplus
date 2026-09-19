# Docker Contract

This project is container-first so every deploy target can build the same service images.

## Local Stack

Copy `.env.example` to `.env`, then run:

```bash
pnpm docker:local
```

Local services:

- `web` on `http://localhost:3000`
- `api` on `http://localhost:3001/v1/health`
- `api` OpenAPI UI on `http://localhost:3001/docs`
- `ai-gateway` on `http://localhost:3002/v1/health`
- `ai-gateway` OpenAPI UI on `http://localhost:3002/docs`
- `postgres` on `localhost:15432` by default (`POSTGRES_PORT` overrides host port)
- `redis` on `localhost:6379`
- `minio` on `http://localhost:19000` by default (`MINIO_API_PORT` overrides host port)
- `minio console` on `http://localhost:19001` by default (`MINIO_CONSOLE_PORT` overrides host port)

## Deploy Contract

Each deployable app has its own Dockerfile:

- `apps/web/Dockerfile`
- `apps/api/Dockerfile`
- `apps/ai-gateway/Dockerfile`
- `apps/workers/Dockerfile`

All six Dockerfiles (the four above plus `apps/web/Dockerfile.lambda` and
`infra/api-web/Dockerfile.api-web`) share one digest-pinned base: `node:22-trixie-slim`
(Debian 13). Debian 12 left regular security support on 2026-06-11; see
`docs/runbooks/cloud-environment-operations.md` ("ECR scan gate") for the CVE rationale and the
package-name rules that come with it.

Dockerfiles build required workspace dependencies inside the image through Turbo, so local builds do not require host `dist/` outputs. Their final stages contain only compiled/standalone artifacts and production dependencies; the API Compose service explicitly selects the tooling-bearing `local` target for local migration/seed setup.

Build examples:

```bash
docker build -f apps/web/Dockerfile -t watchdog-bms-web:local .
docker build -f apps/api/Dockerfile -t watchdog-bms-api:local .
docker build -f apps/ai-gateway/Dockerfile -t watchdog-bms-ai-gateway:local .
docker build -f apps/workers/Dockerfile -t watchdog-bms-workers:local .
```

Production deploy scripts do not build from the live worktree. They call `infra/docker/build-clean-production-image.sh`, which archives one Git commit, adds its OCI revision label, and runs `infra/docker/verify-production-image.sh` against the exported final filesystem before push. ECR tags are resolved to digests before a task/service update. CI repeats the final-filesystem gate and stores an SPDX JSON SBOM per image.

Automatic CI runs only for pull requests, where source, test, audit, secret, config, and
migration gates validate the exact PR head before merge. Branch pushes do not start a duplicate
suite. Explicit manual and approved reusable deployment calls retain the image compatibility
and publication path.

The `CI` workflow publishes the three active ECS images only on a manual run or an
approved reusable deployment call. UAT may reuse validation from an exact successful pull-request CI
only when the source and caller contain the same `ci.yml` blob; otherwise it runs the full
validation gate. Production always runs the full gate. The production OIDC role can push and
inspect only `watchdog-bms-api`, `watchdog-bms-ai-gateway`, and
`watchdog-bms-workers`. Each pushed digest is pulled back, checked by the final-filesystem
gate, matched to its full OCI source revision, and scanned into an SPDX JSON SBOM. Artifact
`production-release-<full-git-sha>` contains the three SBOMs plus
`production-image-manifest.json`; use its `image` values (`repository@sha256:...`) as the only
deployment inputs. BuildKit cache is an optimization only; cache export failure does not
bypass or fail the immutable image evidence path.

The dist-only API image intentionally has no Prisma/tsx/admin scripts. Run migrations plus permission/address sync as an approved release task for the exact commit, retain that evidence, then set `RELEASE_TASKS_APPLIED_SHA=<12-char-git-sha>` for the deploy command. The deploy scripts fail closed when this proof is absent.

For ECS Express, pass the downloaded artifact as `PRODUCTION_IMAGE_MANIFEST=/absolute/path/production-image-manifest.json`. The deploy validates the exact account, region, three service/repository mappings, commit, and digests, then uses those immutable refs without a workstation build or push.

Push pattern for any container registry:

```bash
docker tag watchdog-bms-api:local <registry>/<namespace>/watchdog-bms-api:<version>
docker push <registry>/<namespace>/watchdog-bms-api:<version>
```

For AWS ECR, keep one repository per deployable service:

- `watchdog-bms-web`
- `watchdog-bms-api`
- `watchdog-bms-ai-gateway`
- `watchdog-bms-workers`

AWS-first mapping:

- Web/API/AI Gateway: ECS Express Mode or ECS Fargate. App Runner is legacy rollback only.
- Workers: ECS Fargate service or scheduled task.
- Database: RDS PostgreSQL.
- Queue/cache: ElastiCache Redis or Valkey.
- Files: S3.
- Secrets: Secrets Manager or SSM Parameter Store.

## Mobile

Flutter mobile is not expected to run as a long-lived server container.

Use containers for CI builds later, then publish artifacts to TestFlight and Google Play internal testing.
