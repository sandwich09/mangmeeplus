# P2 Security Hardening L-01–L-15 Spec

## 1. Status

- Checklist: `docs/security-remediation-checklist-merged-2026-07-17.md` §3 (P2 — Low / informational hardening)
- Scope: every unticked P2 finding — L-01, L-03, L-04, L-05, L-06, L-07, L-08, L-09, L-10, L-11, L-12, L-13, L-14, L-15 (there is no L-02; it was merged into `M-12`)
- Owner: Platform/Security; spec + verification Fable 5, implementation Opus 5
- Date: 2026-07-28 (Asia/Bangkok)
- Baseline: current working tree on `develop` (dirty — a concurrent session owns P1 `M-04`–`M-18`)
- Status: In progress

## 2. Goal

Close the low-severity control debt at the authoritative boundary (server, database,
config-boot, log pipeline, infra alarm) so that none of these items can grow into a
real hole when an adjacent capability is switched on. P2 items are hardening: no
finding here is a live exploit in the current tree, so **no change may regress an
existing control, contract, or user journey to close one.**

A P2 checkbox closes on code + focused adversarial tests + typecheck. Where a finding
names live AWS/telemetry/drill evidence, the top-level box stays `[ ]` with a `[x]`
code/test sub-box and an explicit `[ ] Live closure` line — the same pattern already
used by `H-13`, `H-14`, and `M-01`.

## 3. Users and assets

- Employees authenticating to the ERP web app and LINE (sessions, refresh tokens).
- Customers whose PDPA erasure must remove personal data without destroying the audit trail.
- Company financial data whose audit trail must survive process failure.
- Operators who must detect machine-speed abuse from telemetry they actually receive.
- Production API, AI Gateway, AgentCore runtime, workers, Postgres, Redis, CloudWatch.

## 4. Common rules

1. Security decisions run **before** side effects and fail closed.
2. Config that is unsafe or incomplete fails at **boot**, and never echoes a secret value.
3. A control added on one side of a trust boundary must also be enforced on the
   authoritative side (gateway checks do not substitute for ERP checks).
4. Redaction removes personal data **without** destroying non-personal forensic content.
5. No new runtime dependency. No new package. Reuse existing helpers, shared
   constants, and the repo's byte-identical-duplicate guard-test pattern.
6. Liveness is not sacrificed for safety: legitimate concurrent clients (multi-tab
   refresh, retried requests) must not be logged out or locked out.
7. Existing controls in checklist §8, and all of `H-01`–`H-15` / `M-01`–`M-03`, must not regress.

## 5. Finding contracts

### L-01 — Refresh token family reuse detection

Current: `AuthSession.tokenId` is rotated in place; a replayed rotated token returns 401
and revokes nothing; the read-then-write is unguarded so parallel refreshes race.

- Rotation is a **compare-and-set** on the presented `tokenId`. Exactly one concurrent
  refresh wins; the loser observes the CAS miss and never mints a second token pair.
- The session row records the immediately-previous token id and the rotation instant,
  so a replay is distinguishable from an expired session.
- Presenting the previous token **after** the grace window = reuse: the session is
  revoked (whole family), audited `CRITICAL`, and answered 401.
- Presenting the previous token **within** the grace window (default 30s, measured from
  the rotation instant) = benign concurrent refresh, answered **200 with a working token
  pair for the session's current token id**. It does **not** rotate again, so replays
  cannot be chained to slide the window; audited at low risk with a distinct reason.
  This must be an idempotent replay, not an error.
  Rationale, verified against the client: refresh goes through the BFF route
  `apps/web/app/api/auth/refresh/route.ts`, which **clears the auth cookies on any
  non-OK API response**, and `authed-fetch.ts` redirects to `/login` after a second 401.
  So answering the in-grace loser with 401 would not merely inconvenience a second tab —
  it would delete the *valid new* refresh cookie the winning tab had just installed and
  log the user out. Replaying a valid pair keeps every tab alive and needs no web change.
  The security cost is bounded: the presenter already proved possession of a token that
  was valid moments ago, for the same session, inside a fixed short window, after which
  the same presentation revokes the session.
- Grace window is config-driven with a safe default; `0` means strict (revoke immediately).
- Rotation never extends the session beyond the original `expiresAt` (preserve today's behavior).
- The per-session refresh rate-limit bucket is consumed **only after** the session is
  proven ACTIVE, so a holder of a stale token cannot burn a live session's quota.
- Evidence: replay-after-rotation revokes + audits; replay-in-grace does not revoke;
  two-request race yields one winner and one CAS miss; revoked/expired session still 401.

### L-04 — Pin JWT algorithms/issuer/audience at every verifier

- Every verify site pins `algorithms: ['HS256']` — access, refresh, dev, and the AI Gateway
  user-context verifier.
- `iss`/`aud` are always present and always checked: the config layer supplies non-secret
  defaults so the check cannot silently degrade to "unset means skip" outside production.
  Production continues to require explicit values.
- Sign and verify derive `iss`/`aud` from the same source, so they cannot drift.
- A token whose `alg`, `iss`, or `aud` does not match is rejected with 401, not accepted.
- The LINE ID-token verification result is re-checked against the configured channel id
  and a non-expired lifetime before any identity work.
- Accepted residual: API and AI Gateway share one HMAC secret and one audience because the
  gateway verifies the *user's* own access token; splitting audiences would require a
  second minted token and is out of scope. Recorded, not silently dropped.
- Evidence: wrong-algorithm, `alg:none`, wrong-issuer, wrong-audience, and
  refresh-token-as-access negative tests at each verifier.

### L-05 — A token without `sid` must not bypass revocation

- `sid` is **required**. A validly-signed token without `sid` is rejected 401 at the guard;
  the session lookup is never skipped.
- The refresh path rejects a missing `sid` with 401, never a 500 from a `undefined` lookup key.
- The verify-side payload types stop modelling `sid` as optional.
- Evidence: sid-less access token → 401 and no context resolution; sid-less refresh token → 401.

### L-06 — Reduce forgot-password enumeration and timing signal

- The response body, status, and headers are already identical across all outcomes; that must
  stay true.
- The endpoint answers on a **fixed minimum duration** envelope, so the 1-vs-4-6 database
  round-trip difference between "unknown identifier" and "eligible identifier" is not observable.
- Side effects that can take seconds (LINE delivery) stay detached; the detached path keeps
  its own audit.
- The rate-limit bucket key is normalized exactly like the lookup (trim + lowercase) so case
  permutations cannot multiply the per-identifier quota.
- **No account lockout** is introduced, and no identifier-only bucket is added — an
  identifier-only counter would itself become a denial-of-service against a real user's reset.
  This is an explicit product decision, not an omission.
- A denied/limited reset request emits a stable named security event for L-14.
- Evidence: identical response for unknown/ineligible/eligible; measured envelope floor holds
  for the fast branch; case-variant identifiers share one bucket.

### L-03 — Secret entropy, local-value denylist, lifecycle policy

- Production boot rejects a secret that is: shorter than the per-key minimum, drawn from a
  denylist of committed local/example/default values, built from ≤4 distinct characters, or a
  single repeated pattern. Rejection names the **key only**, never the value.
- The rules apply to whatever secret keys are present in the parsed config, not only to the API
  process, closing today's two holes: a production AI Gateway that can fall back to
  `DEV_AUTH_SECRET` for JWT verification, and a production workers process that boots with an
  empty `WORKER_INTERNAL_TOKEN`.
- `SEED_SYSTEM_ADMIN_PASSWORD` becomes a known config key that is forbidden in production, and
  the seed script stops falling back to a hardcoded password when `APP_ENV=production`.
- Entropy rules are deliberately conservative: they must reject every value committed in
  `.env.example` and every test fixture pattern, and must not reject a genuinely random secret.
  Fail-closed at boot is the intent, so the change ships with a documented pre-deploy
  preflight (`pnpm config:validate`) and a rotation/ownership inventory.
- Evidence: per-rule rejection tests using the actual `.env.example` values; a positive test with
  a high-entropy value; a test proving no secret value appears in the error message.

### L-07 — Constant-time comparison for worker/internal secrets

- Every server-side secret/token/CSRF comparison is constant-time and length-safe.
- The one remaining raw `===` on a security token (the web double-submit CSRF check) becomes a
  constant-time compare that works in the Next/Edge runtime with no new dependency.
- The two byte-identical app-local compare helpers get a cross-app guard test so a one-sided
  edit fails CI, following the `NestPinoLoggerBridge` precedent.
- The one API internal route that open-codes the comparison routes through the named assert.
- Evidence: equal, unequal-same-length, unequal-different-length, and empty-expected cases per
  helper; a guard test asserting the two implementations are byte-identical.

### L-08 — Re-enforce AI mutation classification in the ERP executor

- The ERP tool executor is authoritative: before executing, it resolves the tool's registry
  entry and **denies** when the entry is missing, when the category is not in the LINE-allowed
  category set, or when the category is unknown.
- A mutation-classified tool additionally requires the ERP-side final-mutation switch to be on;
  the switch defaults off and is refused in production without approval, mirroring the gateway.
- Denial is durable: it writes an audit row with a stable reason code, and emits a named
  security event. A kill-switch trip is never log-only.
- Today's fail-open `if (meta && …)` shape — an unregistered tool name skipping the permission
  check — becomes fail-closed.
- No behavior change for the 54 read-side tools currently registered.
- Evidence: unknown name denied; registry-known but non-allowed category denied; mutation
  category denied with the switch off; all 54 read tools still permitted.

### L-09 — Deep, key-pattern log redaction and a pinned production log level

- Redaction is **recursive and by key pattern**, not exact-path with a depth-2 ceiling, so
  `apiKey`, `idToken`, `internalSecret`, `channelSecret`, `accessToken`, and nested
  `err.meta.*` are covered wherever they appear.
- Value-level scrubbing removes credentials embedded in strings (for example a
  `postgres://user:pass@host` DSN inside a driver error message).
- Personal data keys (phone, email, LINE user id, national/tax id, address, display name) are
  redacted in logs. This is the **log pipeline only** — it must not change what the audit
  trail stores (see L-11).
- One implementation, shared by the API, the AI Gateway, and the workers process. The dead
  duplicate regex redactor in the config package is replaced by that single implementation
  rather than left to rot.
- `apps/workers` stops writing unredacted `console.*` payloads.
- Production pins the log level (no `debug`) and honors the request-log flag it already parses.
- The existing byte-identical `NestPinoLoggerBridge` guard test must still pass.
- Evidence: canary tests for depth ≥3 nesting, `err.meta`, a DSN in an error message, PII keys,
  and a production-level-pin config test.

### L-10 — Guarantee financial/auth audit delivery

- The audit port can write **inside a caller's transaction**; the repository stops being
  hardwired to the root client.
- Every `CRITICAL`/`HIGH` financial mutation (journal create/post/reverse, period close/unclose,
  payment create/void, document issue/void, vendor-bill approve/void, supplier-payment
  create/void, expense confirm/void, reimbursement payment) and every session-auth event
  (login, refresh, logout, session revoke, reset request) stops being fire-and-forget.
- A failed audit write is retried once and then raises a named, alarm-keyed error event; it is
  never silently swallowed.
- Logout audits even when the actor cannot be resolved (an anonymous logout is exactly the
  event worth keeping).
- The outbox append path stops swallowing errors and stops using a wall-clock fallback for the
  idempotency key.
- Accepted residual, recorded explicitly: the outbox table has no drainer in this repo, and
  converting the void/reversal repositories to in-transaction audit writes is deferred because
  those files are mid-edit by a concurrent session. Post-commit-awaited + retry + alert is the
  guarantee delivered here.
- Evidence: audit-failure surfaces an error event; a mutation whose audit write fails is
  observable; in-transaction audit write proven for at least one path; no financial CRITICAL
  site left unawaited.

### L-11 — Redact PII without destroying non-PII forensic audit

- Erasure performs **field-level** redaction of `AuditLog.metadataJson`: personal-data keys are
  replaced with a redaction marker while every non-personal key (amounts, checksums, counts,
  reasons, state transitions, document numbers) is preserved.
- `actorType`, `actorUserId`, `action`, `targetType`, `targetId`, `requestId`, `result`,
  `riskLevel`, and `createdAt` are never modified.
- Each redacted row carries an in-row marker recording that redaction happened and when.
- The erasure writes an **append-only correction event** describing the redaction (scope,
  counts) in addition to the existing `CRITICAL` erasure row.
- The outbox payload redaction is likewise field-level; the event envelope survives.
- Write-time audit sanitization is **not** widened to strip personal data, because a lawful
  audit trail needs it until an erasure request arrives.
- Accepted residuals, recorded: no hash/sequence chain is added to `AuditLog` (a tamper-evidence
  programme, not P2); audit rows for the same data subject under non-CRM target types are not
  reached by the CRM-scoped redaction.
- Evidence: an erasure that proves personal keys are gone, non-personal keys are intact, the
  row skeleton is unchanged, and the correction event exists; idempotent on re-run.

### L-12 — Bound the AgentCore invocation request body

- The AgentCore runtime enforces a byte cap **while streaming**: it pre-checks `Content-Length`,
  counts bytes as they arrive, destroys the request on overflow, and answers `413` with a stable
  error code. It never buffers an unbounded body.
- Message text, prompt, and the attachments array are individually bounded before reaching the
  orchestrator.
- Concurrent in-flight invocations are capped, answering `429` beyond the cap.
- Limits come from config with safe defaults; nothing is hardcoded at a call site.
- Accepted residual, recorded: the `413` is written, the connection is marked closing, and the rest
  of the upload is discarded (never buffered) for a bounded window before the request is destroyed
  — so a client still uploading usually reads the `413` instead of a reset. Usually, not always:
  closing a socket that still has unread bytes queued is a TCP reset, and a reset discards whatever
  the client had buffered. Measured on loopback with an 8 MB body against a 2 KB cap: 1/20 clients
  saw the `413` with an immediate destroy, 13–18/20 with the lingering close.
- Evidence: oversize `Content-Length` → 413 without reading the body; chunked oversize body →
  413 and destroyed; at-limit body → 200; oversize attachments/text → rejected; over-cap
  concurrency → 429.

### L-13 — Reduce health and framework reconnaissance disclosure

- The public health endpoint returns liveness only — no database status, no dependency detail —
  and performs **no** database query, removing today's unauthenticated database-load
  amplification on a rate-limit-exempt route.
- Deep readiness (including database status) moves to an internal route behind the existing
  worker-token assert.
- The health probe stops writing a raw driver error string through `console.warn`; it uses the
  redacting logger.
- The AgentCore ping stops disclosing the internal service name.
- API docs are exposed only when explicitly enabled, in **every** environment — today any
  non-production `APP_ENV` publishes the full route and DTO surface.
- `x-powered-by` is disabled explicitly, not only by framework default.
- ALB/ECS/App Runner health paths keep returning `200`, so no load-balancer change is required.
- One real consumer of the removed field exists and must be migrated in the same change:
  `infra/prod-ecs-express/verify-deployment.sh:40` asserts `.status == "ok" and .db == "ok"`
  for `api-web`. Dropping `db` without touching that script would fail every future deploy
  verification. The public assertion narrows to `status`, and the database assertion moves to
  the internal readiness route, executed when an operator token is available and reported as an
  explicit skip when it is not — never silently dropped. No other consumer of the field exists
  (verified across `infra/`, `.github/`, `docs/runbooks/`, `e2e/`).
- Evidence: public health body has no `db` key and issues no query; internal readiness requires
  the token and reports `db`; docs disabled without the flag; the deploy verifier still passes.

### L-14 — Bot/anomaly detection signals with a human-owned alert

- A single named-security-event emitter produces stable dotted event names, so an alarm can key
  on a contract instead of on free text.
- Coverage: authentication denial, rate-limit rejection (per-IP and per-identifier), reset
  request denial, LINE webhook signature failure, workflow webhook/SSRF denial, AI tool denial
  with its reason code, AI mutation policy denial, and AI usage/cost signal.
- The AI tool denial reason codes that M-02 made durable in the database are **mirrored into the
  log stream**, because a CloudWatch metric filter cannot see a Postgres row.
- The existing production metric filter already keys on `$.riskLevel = "CRITICAL"`,
  `$.riskLevel = "HIGH"`, `$.msg = "ai.provider.failure"`, and `$.msg = "ai.tool.invoke.denied"`.
  The last clause matches nothing today because that string only ever existed as a database
  audit action, never as a log `msg`. The fix is on the **application** side — emit that exact
  name, and carry a root-level `riskLevel` on every security event so the existing alarm covers
  the new signals with **no infrastructure change**. The deploy script is not edited here: a
  concurrent lane owns it under `M-16`, and editing it is unnecessary once the emitted names
  match what it already looks for.
- A static guard test parses the filter pattern out of the deploy script and asserts every
  `$.msg` literal in it is actually emitted somewhere in the source. That test fails on today's
  tree, which is the point.
- Free-text warnings at the ERP tool boundary become dotted event names.
- Evidence: a focused test per event name proving the emitter fires with the documented fields;
  a static check that every name in the alarm filter is emitted somewhere in the source.
- Live closure (separate): alarm creation, subscription, and delivery to a named human owner.

### L-15 — Backup tombstone and re-erasure after restore

- The erasure tombstone ledger must outlive the record it exists to outlive: it may not be
  deleted by a cascade from the customer row.
- The post-restore re-erasure procedure, its script, and the drill runbook are in place (built by
  the concurrent P1 session); this item verifies them and closes the durability coupling.
- Evidence (code): the tombstone survives a hard delete of its subject; the requeue is idempotent.
- Live closure (separate): an executed restore drill with recorded re-erasure evidence, and live
  backup/log retention aligned to the documented 35-day/90-day windows.

## 6. Out of scope

- Building an outbox drainer/worker (product gap, pre-existing, recorded as residual).
- A hash/sequence tamper-evidence chain on `AuditLog`.
- Deleting the unrouted email-link password-reset use cases (dead but DI-registered and
  covered by a spec the concurrent session is editing; recorded as a follow-up).
- Splitting the API/AI-Gateway JWT audience.
- Any live AWS mutation, deploy, secret rotation, or production probe.

## 7. Non-regression list

`H-01` role-grant guards, `H-03` manual-journal invariants, `H-04` true-reversal net-zero,
`H-05` money validation, `H-06` reimbursement idempotency, `H-07` maker-checker,
`H-08` LIFF CSP/no-inline-script, `H-09` QR/claim ordering, `H-11` evidence immutability,
`H-14` `systemWorkerContext` least privilege, `H-15`/`M-01` delegation boundary,
`M-02` logger bridge byte-identity and per-tool audit, `M-03` LINE outbound policy.
