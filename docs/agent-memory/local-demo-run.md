# Agent Memory: local-demo-run

Status: Local AI defaults and object-storage image fixed and merged. Real AI answers still to be verified with a real key.
Owner: Owner (2026-11-25: production is retired; goal is to clone and run the sales demo with real AI answers locally).
Scope: `.env.example`, `infra/docker/compose.local.yml`, README.
Decisions:
- `.env.example` now ships the AI path on as production ran it: `MODEL_PROVIDER=bedrock`, orchestration + tool-use loop on, `LINE_AI_AGENT_RUNTIME=strands-local`, the `global.` profile pair set (local-only values), and `global.anthropic.claude-haiku-5-5` on the approved list (the compose model). A developer adds only `ANTHROPIC_API_KEY`.
- Why the pair matters: with a `global.` `BEDROCK_MODEL_ID` and the approval off, `line-reliability-capabilities` answers `ready:false` and every LINE/demo chat turn is refused `AI_BUDGET_UNAVAILABLE` before any model call.
- Object storage for local Docker: `coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` for both the server and the bucket-setup container (owner choice 2026-11-25). `minio/minio` and `minio/mc` are no longer pullable from Docker Hub and `quay.io/minio/*` is not public either. The image bundles `mc`, so the setup commands and the line pinned by `infra/docker/production-image-security.spec.sh` are unchanged.
Open questions: none.
Artifacts: branch `claude/affectionate-cori-kngs8h`.
Verification: 2026-11-25 native run (Postgres/Redis in Docker, moto as S3 stand-in, apps via node): migrate + seed pass; sales login → create demo link → open as customer → chat message reaches the Anthropic API call with `claude-sonnet-4-6` (dummy key, 401). Real answers and document reading not yet verified with a real key. `packages/config` tests 150 pass against the new `.env.example`. With the new image: `compose up postgres redis minio minio-create-bucket` creates the bucket, versioning and lifecycle; migrate + seed pass against it.
Next: verify real AI answers and document reading once a session has `ANTHROPIC_API_KEY` (set on the `mangmeeplus` cloud environment 2026-11-25; needs a new session).
