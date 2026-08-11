# Production Global Maintenance Mode Spec

Status: Implementation authorized on 2026-08-10

## Goal

Deploy and exercise the complete production release while customer access remains closed. Keep the
ordinary MangmeePlus login screen available, but authenticate only a platform onboarding operator
with the existing `SYSTEM_ADMIN` role. The operator can use the system console to view and change a
singleton customer-access switch. Ordinary accounts cannot log in or use an existing session while
the switch is closed. LINE, uploads, business APIs, AI Gateway, and worker queues remain closed until
the switch is open and the deployed production serving mode is `live`.

## Runtime contract

- `GLOBAL_MAINTENANCE_MODE` accepts only `true` or `false`; missing/empty is `false`. In production,
  `PRODUCTION_SERVING_MODE` is mandatory and the two values must agree. Missing, malformed, or
  contradictory values stop the proxy at boot so a split production setting cannot fail open.
- When `true`, the proxy forwards the web shell, auth routes, the public platform-access status,
  and `/v1/system/*`. Authentication and the API guard still fail closed: only `SYSTEM_ADMIN` may
  receive or use a session. A valid ordinary member receives `platform_access_closed` before token
  issuance; the BFF clears any browser auth cookies and shows the public maintenance page. Invalid
  credentials or an account without an active membership remain ordinary login failures. Exact
  health/readiness routes retain their existing behavior.
- LINE webhooks, uploads, business APIs, callbacks, local-storage routes, and mutations are answered
  directly by the outer proxy with maintenance JSON; their bodies are never forwarded. AI Gateway
  and workers remain closed independently.
- Maintenance responses intentionally use HTTP 200 plus `X-Mangmee-Maintenance: active` because
  the ECS Express canary alarm treats intentional 4xx/5xx responses as rollout failure. They also
  set `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, strict security headers, and no
  cookies. The body/header pair, not the status alone, is the maintenance proof.
- Worker services remain healthy but use `QUEUE_ENABLED=false` while maintenance is active, so no
  scheduled or queued business work starts from the new release. Production worker configuration
  rejects a missing mode or a queue value that contradicts the canonical serving mode before any
  consumer starts.
- The AI Gateway permits only exact `GET`/`HEAD /v1/health`; all other direct-origin requests stop
  before helmet, CORS, JSON parsing, authentication, provider selection, or tools.
- `PlatformAccessControl` is a singleton `OPEN`/`CLOSED` runtime switch. A missing/unreadable value
  fails closed in production and defaults open outside production. Only `SYSTEM_ADMIN` with the
  existing `system.launch_gate.manage` permission may change it, and every change is audited.
- `maintenance_only` overrides the switch to effective `CLOSED` and reports `canOpen=false`. Opening
  therefore requires a legal/security-approved `live` production release first; after that release,
  `SYSTEM_ADMIN` may open or close customer access without another deployment.
- `SYSTEM_ADMIN` is a platform operator, not a customer representative. It is exempt from the
  customer Terms/Privacy clickwrap and no acceptance record is fabricated. All other users retain
  the existing acceptance requirement after customer access opens.

## Production release contract

- Add `maintenance_only` to `deploy-production.yml`, default `false`.
- `maintenance_only=true` is valid only for an all-target release bound to an exact successful UAT
  run. It is never a partial-incident escape hatch. The controller, not a repository variable,
  forces the runtime flag.
- The first closure uses the separate `maintenance_bootstrap=true` intent. It deploys all three
  UAT-attested images, runs only a read-only production migration-catalog preflight, and cannot
  apply migrations or create a launch-operation authority record.
- `target=auto` with `maintenance_only=true` may derive that bootstrap intent when the active
  Production API source is an ancestor but the requested source adds Prisma files. Its read-only
  preflight accepts pending migrations only when every already-applied migration is the exact
  ordered checksum-matching prefix of the requested repository catalog. Unknown, reordered,
  missing-middle, or edited applied migrations remain fatal. Live automatic promotion never uses
  this derivation.
- Only launch-specific evidence that depends on opening customer access may be deferred while this
  fail-closed mode is active. Maintenance is not a legal exemption: minimum residual-processing
  obligations and evidence remain required, including controller/contact identification, a concise
  notice, purposes and retention for security/access logs, data-subject rights handling, incident
  and security controls, and protection of data already stored. The controller must validate exact
  maintenance-gate and deploy wiring for both final and bridge sources before AWS rollout access.
  UAT, immutable image, signature, health, rollback, and evidence controls remain required for
  bootstrap; the later full promotion additionally retains the reviewed migration,
  security-preflight, and independent owner-approval chain.
- `maintenance_only=false` retains both existing legal evidence gates unchanged and forces the
  runtime flag off.
- A full promotion may use only a bridge release that already contains the same validated global
  gate. The old public release cannot be used as a maintenance bridge. The bridge may be the same
  source and digest as the final release only after a maintenance bootstrap: before mutation the
  controller must prove all three active services match that signed manifest and the global
  closed-state evidence. This removes the need for a no-op source commit without weakening the
  runtime bridge boundary.
- Exact-byte policy is limited to the small enforcement and runtime-wiring boundary whose behavior
  can open ingress, issue/refresh sessions, start queues, change signed-URL lifetime, or mutate the
  production release path. Presentation components and broad append-only registries are not pinned
  byte-for-byte: their required maintenance invariants are checked semantically and their journeys
  remain covered by focused tests plus the exact UAT-attested images. This prevents an unrelated UI,
  schema, config, or audit-taxonomy addition from making the release mechanically undeployable.
- Intentional changes inside the exact boundary use the deterministic local pin-sync command before
  push. CI runs the same command in check mode before expensive jobs fan out and reports that
  remediation directly; the production controller still pins the resulting validator bytes, so
  convenience does not create a bypass.

## Rollout ceremony

1. Merge and run all-target UAT for maintenance-capable source A.
2. Deploy source A to all production services with `maintenance_only=true` and
   `maintenance_bootstrap=true`; wait for canary success and one active configuration per service,
   then prove the custom domain, raw API origin, and raw AI origin show maintenance while the
   worker configuration has `QUEUE_ENABLED=false`. The bootstrap runs the read-only maintenance
   preflight and does not apply a database migration.
3. Run all-target UAT for source B, whose image contains the identical gate. If source A itself
   carries pending migrations, A may remain the final source as well; a second no-op UAT source is
   not required.
4. Promote B with `target=all`, using A as the exact bridge and keeping maintenance true through
   bridge, reviewed migration, final rollout, and rollback handling. Reimbursement writes remain
   quiesced; the ordinary unquiesce and POST-live chain are deliberately skipped.
5. Verify exact digests, singleton configurations, liveness, read-only database catalog
   compatibility, disabled worker queues, and a route/method matrix against custom and raw origins.
   From the moment singleton maintenance is proved, wait 900 seconds so every previously issued
   direct S3 upload/download URL has expired under the byte-pinned URL lifetime contract, and save
   a separate timestamped drain proof.
   Deep database readiness is reported separately and is not claimed unless the guarded operator
   credential was actually supplied.
6. Keep the customer-access switch closed until a separate legally approved
   `maintenance_only=false` release. Once the approved source is verified live, the
   onboarding `SYSTEM_ADMIN` opens customer access from the system console.

This is a verified `DEPLOYED_NOT_LAUNCHED` state, not a private network and not a claim of zero PDPA
processing. Exact health routes, infrastructure traffic logs, named operators, and any data already
stored remain operational processing. The closed-state login notice identifies the company and
privacy contact, explains that customer access and business intake are inactive, and keeps the
public privacy notice reachable. AWS WAF is not part of this release
because the current
production operator role has no WAF authority; the two-release ceremony ensures every api-web
revision that can serve during the full rollout already contains the same gate.

## Acceptance criteria

- `/login`, required Next assets, auth, the read-only access-status route, and `SYSTEM_ADMIN` system
  console routes are forwarded. The public login page states only that the system is under
  maintenance and does not disclose the privileged operator path.
- An ordinary active-member credential receives `platform_access_closed`, creates no session token,
  clears browser auth cookies, and lands on `/maintenance`. An existing ordinary session cannot use
  or refresh protected access while closed and protected web layouts redirect it to `/maintenance`.
  A `SYSTEM_ADMIN` credential signs in and lands directly on `/system/platform-access`.
- LINE employee/CRM webhooks, uploads, local storage, callbacks, business API routes, and mutations
  cannot reach either fake upstream while maintenance is active.
- Health/readiness exact paths only are forwarded; near matches and encoded/double-slash variants
  stay blocked. HEAD has no body.
- The existing login shell remains responsive and makes no unnecessary third-party request. Its
  closed-state notice identifies the company/privacy contact and explains that customer access,
  LINE, documents, and business processing are not active.
- The system console shows the effective state and requested state. `OPEN` is disabled with an
  explanation whenever the deployment is `maintenance_only` or the state cannot be verified.
- `SYSTEM_ADMIN` legal status is always `required=false` without inserting legal-action rows.
- Deploy config contains exact maintenance state on api-web and exact inverse queue state on
  workers. Verification fails on mismatch.
- Normal production mode still requires the complete legal bundle and cannot inherit a stale
  maintenance value.
- Final production evidence includes custom-domain, api-web raw-origin, AI raw-origin, exact
  source/image bindings, disabled queue state, and the 900-second direct-storage URL drain. No claim
  of zero PDPA processing is made; the state is `DEPLOYED_NOT_LAUNCHED`.
