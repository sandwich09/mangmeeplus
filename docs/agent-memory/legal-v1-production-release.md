# Agent Memory: legal Version 1 Production release

Status: Production candidate is healthy and globally closed. The first reviewed recovery reached
all immutable/provider checks but stopped before build or mutation on one transient 20-second HTTP
timeout; bounded read-only HTTP proof hardening is under local verification before one retry.

Owner: Codex / repository owner

Scope: Publish the internally immutable `v3` legal bundle as the first public/counsel edition
`Version 1 (1.0)` to UAT and Production, while keeping Production `maintenance_closed` until the
signed counsel bundle passes the live legal-evidence gate.

Decisions:

- Internal release ID remains `v3` so repository history is append-only. All user- and
  counsel-facing labels remain `Version 1 (1.0)` because this is the first real promotion.
- The unsigned legal-evidence manifest remains `BLOCKED`; this release may reach
  `PROMOTED_CLOSED` but must not open customer traffic.
- Never retry a failed Production run while its durable release operation is non-terminal.
- The failed run exposed an argument-size bug in exhaustive ECS deployment pagination. Fix both
  accumulation and final output to use a bounded temporary stream, and execute a provider-shaped
  regression larger than the host argument limit.
- The exact recovery for this incident may terminalize only a failed Production V2 parent with no
  api-web intent, zero OPEN intents, and either zero intents or a bounded set of non-api BOUND
  non-no-op intents whose count and append-only evidence exactly match the failed-run artifact. Two live reads must
  also prove all three services are the exact candidate in `maintenance_only`. Recovery records
  `RECONCILED_FAILED_CONFIRMED`; it does not relabel the failed promotion as success.
- Read-only HTTP proofs use three bounded attempts (20 seconds each, 70-second retry ceiling).
  Provider 429/5xx and transport failures may retry; HTTP identity/body/marker drift still fails
  closed. No mutation command receives automatic retry authority from this change.

Open questions:

- None in source design. Live recovery and the clean retry remain intentionally provider-backed.

Artifacts:

- Candidate/source: `748f1fa87f57e4c7b899e7dfec5bd62ea2d8c916`
- UAT/Passport: run `31766454624`, success; deep DB readiness and full legal acceptance passed.
- READY: run `31767633917`, success, `maintenance_closed`, exact match/no pending migration.
- Failed Production: run `31768078758`; first failure was
  `list-service-deployments-all.sh: line 81: /usr/bin/jq: Argument list too long` before api-web
  intent preparation. Recovery hit the same error; finalizer then correctly refused absent api-web
  rollout evidence.
- Durable parent: `ea25d4e5-bb94-4128-84f3-48064fcfb1c7`; original release task
  `e757be59910a47dc921e3d289f8d5fb9`; the stopped-task record has aged out of ECS.
- Failed-run controller evidence artifact digest:
  `sha256:2f294e2d6324be9892dc1eb8baba53196573f8bebaff22b52336abceafd553df`.
- First recovery controller: merged main `d161c5b6a7e2f3bbecfccb405c3c75b121b84073`, exact-main CI
  run `31778631591` success. Recovery run `31779613515` failed before ECR login/build/executor/DB
  mutation because the deep-readiness curl timed out once after 20 seconds with zero bytes.

Verification:

- Post-failure read-only current-health collection: PASS. api-web, ai-gateway and workers all run
  the exact candidate SHA, return HTTP 200, and report `maintenance_only`.
- Job log proves four non-api intents were prepared and BOUND (two ai-gateway, two workers) and no
  api-web intent was prepared before the pager failed.
- The failed artifact has exactly 17 regular members: 11 fixed controller records, four bounded
  non-api history records and two current non-api roots. Its schema-v2 recovery evidence passes the
  production parser, including byte-order canonicalization of mixed-case ECS deployment IDs.
- Two fresh read-only ECS rounds pass the production recovery validator for all three exact service,
  image, revision, maintenance-control and successful-deployment identities.
- The pager regression joins 184 provider-shaped rows into output larger than 2 MiB without passing
  accumulated JSON through an argv. The live production helper returns all 192 unique deployment
  records with `nextToken:null` on two stable reads.
- Real local PostgreSQL recovery tests pass 35/35 without skips, including partial history,
  duplicate-intent rejection, pending-cleanup rejection, terminalization and replay.
- Full workspace typecheck and tests pass. The workers retry-scheduler test now owns a bounded,
  referenced guard timer instead of depending on unrelated event-loop handles; it passes three
  isolated repetitions and the full workspace run.
- Production image/security aggregate, maintenance validator/pin sync, API typecheck, workflow YAML,
  focused shell contracts, dependency audit (no high/critical finding) and `git diff --check` pass.
- Immediately after run `31779613515`, the same exact Production deep DB readiness endpoint passed
  from the approved non-root profile in under one second. Public and raw-origin `/login` both return
  HTTP 200 with the exact maintenance markers; the full current-health collector passes all three
  services in `maintenance_only`.
- The native-curl regression proves 503 then 200 succeeds in exactly two requests, HTTP 401 is not
  retried, and an HTTP-200 body with the wrong readiness contract is rejected.

Next:

1. Merge the bounded HTTP proof hotfix and require exact-main CI.
2. Dispatch one exact recovery for the parent and prove `RECONCILED_FAILED_CONFIRMED` plus stable
   candidate-closed runtime.
3. Issue a fresh READY on the new controller, freeze main, and dispatch Production once.
4. Accept only signed `PROMOTED_CLOSED` / `DEPLOYED_NOT_LAUNCHED` evidence and secret-safe
   SYSTEM_ADMIN acceptance. Leave live opening blocked until counsel-signed files are uploaded.
