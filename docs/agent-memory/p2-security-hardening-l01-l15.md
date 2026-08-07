# Agent Memory: P2 security hardening L-01–L-15

Status: In progress (2026-07-28)
Owner: Fable 5 (spec/plan/verify) + Opus 5 (implementation/test/fix)

Scope:
- Close every unticked P2 finding in `docs/security-remediation-checklist-merged-2026-07-17.md` §3:
  L-01, L-03, L-04, L-05, L-06, L-07, L-08, L-09, L-10, L-11, L-12, L-13, L-14, L-15.
  There is no L-02 — it was merged into `M-12`.

Decisions:
- One umbrella spec/plan (`docs/specs/p2-security-hardening-l01-l15-spec.md`,
  `docs/plans/p2-security-hardening-l01-l15-plan.md`); finding-specific closure evidence
  stays in the checklist.
- Ponytail full mode. No new package, no new dependency. Reuse the repo's existing
  cross-app byte-identical guard-test pattern instead of extracting shared packages.
- P2 closes on code + focused adversarial tests + typecheck. Where a finding names live
  AWS/telemetry/drill evidence (L-14 alarm delivery, L-15 restore drill), the top level
  stays `[ ]` with a `[x]` code/test sub-box and an explicit `[ ] Live closure` line —
  the pattern already used by H-13/H-14/M-01.
- Audit delivery: `log(entry)` never throws (retry once, then emit `audit.persist.failed`)
  so `await` at a financial call site cannot turn a committed mutation into a 500;
  `log(entry, tx)` does throw so an in-transaction audit failure rolls the mutation back.
- L-06 deliberately adds **no** account lockout and **no** identifier-only rate bucket —
  an identifier-only counter is itself a denial-of-service against a real user's reset.
  The checklist text asks for this explicitly.
- L-01 uses a grace window (default 30s) for the previous refresh token because refresh
  goes through a BFF cookie shared across browser tabs; strict revoke-on-reuse would log
  real users out. Outside the window it is treated as reuse and revokes the session.
- L-11 does not widen write-time audit sanitization: a lawful audit trail needs personal
  data until an erasure request arrives. Redaction is field-level at erasure time.
- Deferred by design (recorded as residuals, not silently dropped): outbox drainer,
  `AuditLog` hash/sequence chain, deleting the unrouted email-link password-reset use
  cases, splitting the API/AI-Gateway JWT audience.

Concurrency hazard (the dominant risk in this task):
- A concurrent session owns P1 `M-04`–`M-18` and is editing the same dirty tree, including
  `packages/config/src/index.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/main.ts`,
  `infra/prod-ecs-express/deploy.sh`, the auth rate-limit service, the CRM/PDPA repository,
  and the financial use-cases.
- Mitigations in force: per-lane file ownership table in the plan; re-read immediately
  before every edit; no `git add -A`; migration timestamps `>= 20260728190000` with one
  timestamp reserved per lane; `apps/api/package.json` test-list registration done once by
  the orchestrator, never by a lane.

Open questions:
- Whether the concurrent session's untracked PDPA migration keeps its current name/shape;
  the L-15 migration is written defensively so it no-ops if not.
- Live AWS evidence (alarm delivery, restore drill, production secret preflight for the new
  L-03 boot rules) requires release authority and is not attempted here.

Artifacts:
- `docs/specs/p2-security-hardening-l01-l15-spec.md`
- `docs/plans/p2-security-hardening-l01-l15-plan.md`
- `docs/security-remediation-checklist-merged-2026-07-17.md` §3

Verification:
- Discovery: four read-only sweeps mapped the current state of all 14 findings with
  `path:line` evidence before any code was written.
- Node must be pinned per shell call: `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"`.
- Local database for migration checks is docker port 15432 / `watchdog_bms`; pass
  `DATABASE_URL` explicitly because `apps/api/.env` carries a stale 5432 value.

Progress (2026-07-28):
- Phase 0 (L-03) and lanes A–D all landed. Integration done by the orchestrator: 9 new API
  specs registered in the hand-maintained `apps/api/package.json` list, `log-redaction.spec.ts`
  registered for the gateway, `prisma generate` re-run, `SWAGGER_ENABLED=true` in
  `.env.example` (docs are now flag-gated in every environment), and `packages/config` rebuilt.
- Verification after integration: API suite 2665/2665, AI Gateway 484/484, Web 381/381,
  `packages/config` 91/91, typechecks clean for api, ai-gateway, workers, contracts, web.
- The stale `packages/config/dist` was a real deploy blocker: built apps resolve `dist`, where
  `DEFAULT_JWT_ISSUER`/`DEFAULT_JWT_AUDIENCE` were absent, so issuer/audience would have been
  `undefined` at both sign and verify while every test passed via tsconfig `paths`.
- Out-of-scope but implemented on request: a recorded exception
  (`AI_GLOBAL_INFERENCE_PROFILE_APPROVED` + `..._APPROVAL_REF`, both required together) that
  permits a `global.` Bedrock inference profile in production so a model newer than the newest
  APAC-published profile can run. Default stays fail-closed; region, model-allowlist and
  provider rules still bind.
- Adversarial review found one MEDIUM regression: refresh was wired into a fail-closed Redis
  limiter, and the BFF clears auth cookies on any non-OK, so a Redis blip would log every
  active user out. Being fixed on both halves (limiter outage is not over-quota; the BFF
  clears cookies only on 401), together with real family-level reuse detection.

Deploy sequencing (sharp): apply `20260728190000_l01_refresh_token_reuse_detection` (and the
later family migration) BEFORE the code reaches production. The refresh path reads the new
columns on every call, and this repo's deploy has no migrate gate — code-first would make every
refresh fail, which the BFF turns into a mass logout.

Outcome (2026-07-28):
- 12 of 14 P2 findings closed top-level: L-01, L-03, L-04, L-05, L-06, L-07, L-08, L-09,
  L-10, L-11, L-12, L-13.
- L-14 and L-15 carry `[x] Code/test remediation` + `[ ] Live closure`, because their stated
  evidence is alarm delivery to a named human owner and an executed restore drill — neither is
  producible from this machine, and claiming them would be false.
- Final verification: API 2695/2695, AI Gateway 485/485, Web 397/397, workers and
  `packages/config` 99/99 green; typechecks clean for api, ai-gateway, workers, web, contracts;
  `git diff --check` clean.

What the adversarial review caught that the implementation lanes had missed — worth remembering
because all three were confidently reported as done:
1. The L-10 conversion list I wrote omitted the reimbursements and banking modules entirely,
   including four CRITICAL sites, while the evidence line claimed no CRITICAL site was left
   unawaited. Enumerating call sites by hand is how that happens; the fix pass grepped instead.
2. Wiring refresh into a fail-closed Redis limiter meant a cache blip logged every active user
   out, and fixing the API and the BFF was still not enough — the web client redirected to
   `/login` on the retried 401 regardless, so the third layer was the one that mattered.
3. `z.coerce.boolean()` on the global-inference-profile flag made `'false'` parse as `true`, so
   the documented "off" value both blocked boot and made the switch impossible to turn off.
   `envBoolean` already existed in the same file and every other boolean key used it.

Standing traps confirmed again this session:
- New API specs must be registered in the hand-maintained `test` list in `apps/api/package.json`
  (and the equivalent list in `apps/ai-gateway/package.json`), or they silently never run.
- `packages/config/dist` must be rebuilt after editing the package: built apps resolve `dist`,
  tests resolve source via tsconfig `paths`, so a stale `dist` yields `undefined` exports while
  everything looks green.
- Fail-closed boot rules need a false-rejection test with sampled random values, not a single
  assertion — a rule that misfires on 1 in 200 secrets looks green and bricks a deploy later.

Next:
- Deploy sequencing: apply the two L-01 migrations before the code reaches production.
- Follow the spawned tasks: Redis-down policy sign-off, prod-required env reconciliation,
  duplicate goods-receipt audit rows.
- L-14 and L-15 live closure when release authority and an environment are available.
