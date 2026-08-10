# Production Global Maintenance Mode Spec

Status: Implementation authorized on 2026-08-10

## Goal

Deploy and exercise the complete production release while the customer-facing product remains
closed. Every request entering the combined public API/web origin must stop at the outer runtime
proxy before Next.js, NestJS, authentication, LINE webhook parsing, file upload, database access,
or queue enqueue. The AI Gateway applies the same stop before body parsing, and worker queues remain
disabled. Users see a MangmeePlus-branded maintenance page only.

## Runtime contract

- `GLOBAL_MAINTENANCE_MODE` accepts only `true` or `false`; missing/empty is `false`. In production,
  `PRODUCTION_SERVING_MODE` is mandatory and the two values must agree. Missing, malformed, or
  contradictory values stop the proxy at boot so a split production setting cannot fail open.
- When `true`, only `GET`/`HEAD` for exact `/v1/health` and
  `/v1/internal/health/readiness` may reach the API. The readiness route keeps its worker-token
  authentication in NestJS.
- Every other host, path, query, and method is answered directly by the outer proxy. Browser
  navigation receives one inline, dependency-free Thai maintenance page. API/BFF/LINE/upload
  routes receive a small maintenance JSON response. Request bodies are never forwarded.
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
- Opening the product is a separate production deployment with maintenance `false`; it is never a
  tenant/admin setting and never changes in place without the production workflow.

## Production release contract

- Add `maintenance_only` to `deploy-production.yml`, default `false`.
- `maintenance_only=true` is valid only for an all-target release bound to an exact successful UAT
  run. It is never a partial-incident escape hatch. The controller, not a repository variable,
  forces the runtime flag.
- The first closure uses the separate `maintenance_bootstrap=true` intent. It deploys all three
  UAT-attested images, runs only a read-only production migration-catalog preflight, and cannot
  apply migrations or create a launch-operation authority record.
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
  gate. The old public release cannot be used as a maintenance bridge.

## Rollout ceremony

1. Merge and run all-target UAT for maintenance-capable source A.
2. Deploy source A to all production services with `maintenance_only=true` and
   `maintenance_bootstrap=true`; wait for canary success and one active configuration per service,
   then prove the custom domain, raw API origin, and raw AI origin show maintenance while the
   worker configuration has `QUEUE_ENABLED=false`. The bootstrap runs the read-only maintenance
   preflight and does not apply a database migration.
3. Run all-target UAT for source B, whose image is distinct and contains the identical gate.
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
6. Keep the product closed until a separate legally approved `maintenance_only=false` release.
   Under the current bridge contract that opening is a distinct all-target UAT source C using the
   closed source B as its bridge; re-dispatching source B in place is not an approved shortcut.

This is a verified `DEPLOYED_NOT_LAUNCHED` state, not a private network and not a claim of zero PDPA
processing. Exact health routes, infrastructure traffic logs, named operators, and any data already
stored remain operational processing. The maintenance page identifies the company and privacy
contact, explains that request content reaching the MangmeePlus/LINE gate is discarded without
being imported into or stored in the business system, and gives a concise notice for IP address,
time, User-Agent, security-log purposes, retention, and rights. AWS WAF is not part of this release
because the current
production operator role has no WAF authority; the two-release ceremony ensures every api-web
revision that can serve during the full rollout already contains the same gate.

## Acceptance criteria

- `/`, `/login`, legal pages, Next static paths, auth, API, LINE employee/CRM webhooks, uploads,
  local storage, callbacks, and mutations cannot reach either fake upstream in focused tests.
- Health/readiness exact paths only are forwarded; near matches and encoded/double-slash variants
  stay blocked. HEAD has no body.
- Maintenance HTML is responsive, uses MangmeePlus green/gold tokens and inline sprout-coin mark,
  makes no third-party request, accurately explains discarded request content, and includes the
  company, privacy contact, residual-processing notice, retention rule, and rights channel.
- Deploy config contains exact maintenance state on api-web and exact inverse queue state on
  workers. Verification fails on mismatch.
- Normal production mode still requires the complete legal bundle and cannot inherit a stale
  maintenance value.
- Final production evidence includes custom-domain, api-web raw-origin, AI raw-origin, exact
  source/image bindings, disabled queue state, and the 900-second direct-storage URL drain. No claim
  of zero PDPA processing is made; the state is `DEPLOYED_NOT_LAUNCHED`.
