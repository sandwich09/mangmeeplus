# Agent Memory: local-demo-run

Status: Local AI defaults fixed and merged. Object-storage image for local Docker is NOT fixed — waiting on owner choice.
Owner: Owner (2026-11-25: production is retired; goal is to clone and run the sales demo with real AI answers locally).
Scope: `.env.example`, `infra/docker/compose.local.yml`, README.
Decisions:
- `.env.example` now ships the AI path on as production ran it: `MODEL_PROVIDER=bedrock`, orchestration + tool-use loop on, `LINE_AI_AGENT_RUNTIME=strands-local`, the `global.` profile pair set (local-only values), and `global.anthropic.claude-haiku-5-5` on the approved list (the compose model). A developer adds only `ANTHROPIC_API_KEY`.
- Why the pair matters: with a `global.` `BEDROCK_MODEL_ID` and the approval off, `line-reliability-capabilities` answers `ready:false` and every LINE/demo chat turn is refused `AI_BUDGET_UNAVAILABLE` before any model call.
Open questions:
- `minio/minio` and `minio/mc` are no longer pullable from Docker Hub, and `quay.io/minio/minio` / `quay.io/minio/mc` are not public either (both checked 2026-11-25; other public repos on both registries answer). A fresh machine cannot `pnpm docker:local`; the seed needs object storage. Candidates still public on Docker Hub: `coollabsio/minio` (community build, server only as far as checked) and `bitnamilegacy/minio` + `bitnamilegacy/minio-client` (frozen archive). Choosing a third-party image is the owner's call. `infra/docker/production-image-security.spec.sh:853` pins the `mc ilm rule import` line, so a client swap must update it.
Artifacts: branch `claude/affectionate-cori-kngs8h`.
Verification: 2026-11-25 native run (Postgres/Redis in Docker, moto as S3 stand-in, apps via node): migrate + seed pass; sales login → create demo link → open as customer → chat message reaches the Anthropic API call with `claude-sonnet-4-6` (dummy key, 401). Real answers and document reading not yet verified with a real key. `packages/config` tests 150 pass against the new `.env.example`.
Next: owner picks the object-storage image; verify real AI answers once a key is provided.
