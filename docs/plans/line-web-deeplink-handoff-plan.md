# LINE → Web Deep-Link Session Handoff — Implementation Plan

## Linked Spec

- Spec: `docs/specs/line-web-deeplink-handoff-spec.md`
- Extends: `docs/specs/line-ai-channel-auth-spec.md` §5 "Alert to Web Detail" step 4 — the LIFF/authenticated deep link the spec already promises but the code never shipped (spec §3.1 E9, E10)
- Constrained by: `docs/specs/password-reset-line-flow-spec.md` ("Session provider claim (UC1 scoping)", decision 1, acceptance 3)
- Task memory: `docs/agent-memory/line-deeplink-company-access-mismatch.md`
- Related guidelines: `AGENTS.md` (ponytail rule, AI-Gateway/ERP-core boundary), `docs/plans/master-implementation-checklist.md`

## Purpose

Make a LINE deep link open as the person the message was sent to. Today the link is a bare URL and the
opening browser's existing session decides who reads it, which produced seven "ไม่สามารถเข้าถึงบริษัทนี้ได้"
denials across three accounts in a three-day UAT window (spec §3.1 E7), each resolved by the user
manually signing out and back in. The same gap also forces a password prompt on any phone that has no
session at all.

## Current Repository Context

### Apps/packages to inspect

- `apps/api/src/modules/line-ai/` — every link-emitting surface: `line-ai-formatter.logic.ts:50,64`, `process-line-webhook.use-case.ts:304` (`absoluteWebLink`), `line-staff-menu.logic.ts:250` (flex `uri`), `line-business-card.logic.ts:79,101`
- `apps/api/src/modules/auth/` — `auth.controller.ts`, `auth.guard.ts:175`, `issue-token.use-case.ts:47`, `complete-employee-line-link.use-case.ts` (the claim pattern to copy)
- `apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts:107-118` — token generation and hashing to reuse verbatim
- `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:712-728` — the alert-rail link builder
- `apps/api/prisma/schema.prisma:6022` — `EmployeeLineLinkToken`, the shape the new model mirrors
- `apps/web/app/api/auth/dev-login/route.ts` + `apps/web/src/common/auth/auth-cookies.server.ts` — exchange → cookies → landing, already proven
- `apps/web/proxy.ts:73-78`, `apps/web/src/common/auth/middleware.logic.ts:6-12,63` — route gating and `next` sanitisation
- `apps/web/app/(workspace)/companies/[companyId]/layout.tsx:36-42` — where the deep-link destination is dropped by both gates (spec G4)

### Existing patterns to reuse

- Single-use LINE token: 24 random bytes base64url, sha256 in the database, TTL constant, claim-before-mutate, audit on both issue and failure (`EmployeeLineLinkToken` family).
- BFF cookie write: `setAuthCookies(res, tokens, { csrfToken, homePath, persistent })` — never set auth cookies anywhere else (`auth-cookies.server.ts:2`).
- Public-endpoint refusal style: one generic message to the caller, the real reason to audit (`password/reset-request`, `complete-employee-line-link`).
- `emitSecurityEvent` + `SECURITY_EVENT` for anything a CloudWatch metric filter should alarm on.

### Known dependencies

- One Prisma model + migration.
- `AppConfigService.webBaseUrl` becomes the single web base URL (spec G3 collapses two rogue resolutions with cross-environment fallbacks).
- No new npm dependency. No AI Gateway change — minting sits in ERP Core at the send boundary.

### Open implementation risks

- **R1 (blocking rollout).** Something between the OA and the tap may fetch the URL and burn the single-use token (spec G7, Q2). Unmeasured. Phase 1 exists solely to measure it before any user sees a handoff link.
- **R2 (blocking build).** The `provider` claim decision (spec G6, Q1) changes which code the exchange calls; it must be answered before Phase 2.
- **R3.** Registering a new API spec requires editing the hand-maintained file list in `apps/api/package.json` (`"test"` script), which `AGENTS.md` forbids for non-dependency changes while `password-reset-line-flow-spec.md` acceptance 7 requires it. Resolve explicitly with the owner rather than silently picking a side; until then the new API specs run locally via `pnpm --filter api exec tsx --test <file>` and that command goes in the PR body as evidence.
- **R4.** Replacing cookies mid-session on a shared device signs the previous person out of that browser. Intended (spec §7) but it must be stated in the release note.

## Implementation Rules

- Follow `docs/plans/master-implementation-checklist.md`.
- Keep route/controller files thin: the exchange controller validates the body and delegates.
- Reuse the token/claim/audit helpers above before writing new ones.
- Do not implement outside the phase scope; Phase 4 and 5 do not start until Phase 1's answer is recorded.
- No final business mutation moves into LINE. The handoff carries identity only.

## Scope

### In Scope

- `LineWebHandoffToken` model, mint seam, exchange endpoint, `/l/<token>` web route.
- Wiring the assistant reply surfaces (`line-ai`) and, in a later phase, the alert rail.
- Collapsing the three web base-URL resolutions onto `AppConfigService.webBaseUrl` (spec G3).
- Carrying the requested path through the `mustChangePassword` and legal-acceptance gates (spec G4).
- Auditing company-access denials with user and company (spec G5).

### Out of Scope

- LINE Login for the web (`/v1/auth/line/exchange` stays deferred).
- CRM customer channels (spec G9).
- Company switching, or pre-checking the target route's permission at send time (spec G8).

## Phase 0: Discovery and Alignment

### Goal

Confirm the spec's evidence still holds and get Q1/Q3 answered before any code.

### Tasks

- [ ] Re-read spec §3.1 and re-run the two cheap checks: the `/v1/auth/me` 403 count in the retained UAT window, and `WEB_BASE_URL` on the UAT service.
- [ ] Get the owner decision on Q1 (`provider` claim) and Q3 (TTL per surface). Record both in this plan.
- [ ] Confirm with the owner whether the alert rail ships in Phase 4 or waits (Q4).

### Tests

- None; discovery only.

### Exit Criteria

- Q1 and Q3 answered in writing here. R3 resolved or explicitly deferred.

## Phase 1: Measure the preview risk (R1)

### Goal

Prove that a one-time link in a LINE message is not consumed before the human taps it. This phase
gates everything after it, and it is deliberately cheap enough to run before the real model exists.

### Tasks

- [ ] Add a throwaway `PENDING` row by hand in UAT (or a temporary `--dry-run` mint behind an env flag) whose exchange endpoint only logs and never issues a session.
- [ ] Send the URL through the UAT OA to a test LINE account. Do not tap it.
- [ ] After 10 minutes, read `usedAt` and the audit rows.
- [ ] Repeat once with the link inside a flex button (`uri` action) — the preview path may differ from plain text.

### Tests

- Manual, recorded in `docs/agent-memory/line-deeplink-company-access-mismatch.md` with timestamps.

### Exit Criteria

- Written evidence that the token is untouched until the tap — or, if it is consumed, a recorded decision to adopt the interstitial `POST` mitigation (spec G7) before Phase 2 continues.

## Phase 2: Token, exchange endpoint, audit

### Goal

The server side works end to end, verified by tests, with nothing in LINE changed yet.

### Tasks

- [ ] Prisma: add `LineWebHandoffToken` per spec §9 and generate the migration.
- [ ] `apps/api/src/modules/auth/domain/logic/line-handoff.logic.ts` — token generate/hash (reuse the `employee-access.logic.ts` implementation shape), TTL constants, `isSafeHandoffPath(targetPath, companyId)`.
- [ ] `MintLineHandoffTokenUseCase` — validates the path, writes the row, audits `auth.line_handoff.issue`.
- [ ] `ExchangeLineHandoffTokenUseCase` — the ordered checks and atomic claim from spec §11, then `IssueTokenUseCase` with the provider decided in Phase 0.
- [ ] `POST /v1/auth/line/handoff/exchange` — `@Public()`, rate-limited, generic 403 on every refusal.
- [ ] New audit actions and the `auth.line_handoff.denied` security event.

### Tests

- `line-handoff.logic.spec.ts` — hash stability, TTL boundary, path rejection (wrong company, `..`, off-origin, control characters).
- `exchange-line-handoff-token.use-case.spec.ts` — each refusal reason and its audit metadata; the two-concurrent-exchange race yields exactly one session.
- `auth-endpoints.spec.ts` — the new route is public, rate-limited, and returns the documented shape.
- Command: `pnpm --filter api exec tsx --test src/modules/auth/domain/logic/line-handoff.logic.spec.ts …` (see R3).

### Exit Criteria

- Exchange produces a session whose `/auth/me` matches a password login for the same user, and every refusal path is covered by a test.

## Phase 3: Web entry route and the destination gates

### Goal

A token in a URL becomes a signed-in browser sitting on the target record.

### Tasks

- [ ] `apps/web/app/l/[token]/route.ts` — GET handler: exchange, `setAuthCookies` with `homePath` set to the token's company landing, 303 to `targetPath`. On any failure, 303 to `/login?next=<targetPath>&reason=link_expired`.
- [ ] Confirm the path is not matched by `isProtectedPagePath` and needs no CSRF (GET).
- [ ] Login page: render the `reason=link_expired` line (th/en dictionary keys).
- [ ] Spec G4: replace the hard-coded `returnTo` in `app/(workspace)/companies/[companyId]/layout.tsx` with the actually requested path, so both gates return to the deep link.
- [ ] Spec G5: audit `access.company.denied` where the resolver refuses.

### Tests

- `apps/web` unit: the route's redirect target and cookie set for success and each failure; `homePath` rewrite.
- `session-gate.logic.spec.ts`: the gates preserve a `/companies/<id>/expenses/<id>` destination through legal acceptance and change-password.
- Command: `pnpm --filter @watchdog-bms/web test`, `pnpm --filter @watchdog-bms/web typecheck`.

### Exit Criteria

- With a hand-minted token: a browser signed in as another account lands on the record as the bound user; a second tap lands on `/login` with the destination intact.

## Phase 4: Wire the assistant surfaces

### Goal

Real LINE replies carry handoff links, and a minting failure costs nothing.

### Tasks

- [ ] `LineHandoffLinkService.wrap(...)` in `line-ai`, returning the plain absolute URL when `webBaseUrl` is unset or minting throws.
- [ ] Route every assistant link through it: `line-ai-formatter.logic.ts:50,64`, the `absoluteWebLink` call sites in `process-line-webhook.use-case.ts`, `line-staff-menu.logic.ts:250`, `line-business-card.logic.ts`.
- [ ] Spec G3: delete the `https://mangmeeplus.com` and `https://app.watchdog.local` fallbacks; read `AppConfigService.webBaseUrl`, keep `WATCHDOG_WEB_BASE_URL` as an explicit override.

### Tests

- Formatter specs assert a `/l/<token>` URL when a minter is provided and today's plain URL when it is not.
- Regression: existing `line-ai` formatter/menu specs still pass unchanged where no minter is wired.

### Exit Criteria

- UAT: send a bill from a LINE account whose browser holds a different account's session, tap the reply link, land on the record as the LINE-linked user. This is the exact 2026-08-18 22:00 scenario, reproduced green.

## Phase 5: Alert rail (gated on Q4)

### Goal

`dashboard-notifications` pushes carry the same handoff.

### Tasks

- [ ] Mint in `buildLineMessage`'s caller (it knows the recipient's `userId`), not in the pure builder.
- [ ] Apply the Q3 TTL for pushes.

### Tests

- Notification use-case spec: the pushed text contains a handoff URL; a mint failure still pushes the plain link.

### Exit Criteria

- One real alert delivered in UAT opens without a login prompt.

## Integration Verification

- Backend/API contract: `POST /v1/auth/line/handoff/exchange` returns the field set `app/l/[token]/route.ts` consumes; `/auth/me` under the new session matches a password login for the same user.
- Web journey: LINE tap → record, from (a) no session, (b) the same user's session, (c) another user's session, (d) an expired token.
- Loading/error/permission states: expired-link line on `/login`; the target page's own forbidden state when the user lacks the module permission (spec G8 — unchanged behaviour, verified not to regress).
- E2E/browser check: extend the existing auth E2E with the (c) case, the one that produced the incident.
- Commands: `pnpm --filter api exec tsx --test <new specs>`, `pnpm --filter @watchdog-bms/web test`, `pnpm --filter @watchdog-bms/web typecheck`.

## Product Evidence

- Journey and roles: spec §5, §6. The reported user is a newly created STAFF member (`kimtae@gmail.com`, ALL_BRANCHES, one active membership).
- Value: seven denials in three days, all self-resolved by manual re-login (spec §3.1 E7); plus every no-session tap currently costing a password entry on a phone.

## Architecture Evidence

- Boundary: minting is ERP Core at the send seam; the AI Gateway never sees a token (`AGENTS.md` — AI Gateway calls permission-checked APIs, not repositories).
- Contract: the exchange returns the same token/flag shape the BFF login route already consumes (`app/api/auth/login/route.ts`).
- Data model: one new table, mirroring an existing one; no change to `AuthSession`, `ExternalIdentity`, or `LineCompanyContext`.

## Implementation Evidence

- Smallest correct diff: one model, two use cases, one controller route, one web route, plus the link-emission seam. No new dependency; token generation, hashing, claiming, and auditing all reuse the employee-link implementation.

## Integration Evidence

- Middleware, CSRF, CSP, and `Referrer-Policy` all already cover the new route (spec §3.1 E14, E15); the plan adds no security header work.

## Risks

- R1 preview consumption — gated by Phase 1.
- R2 provider claim — gated by Phase 0.
- R3 API test registration vs the `package.json` rule — decide with the owner.
- R4 replacing a shared browser's session — intended, needs a release note.
- A token is a bearer credential in a chat log. Mitigated by single use, short TTL, company+path binding, and `Referrer-Policy: no-referrer`; not eliminated. Anyone with access to the user's LINE chat within the TTL can open that one record — which is the same person who can already read the assistant's answer about it.

## Open Questions

- Q1 (spec §17): which `provider` claim — blocks Phase 2.
- Q2 (spec §17): preview consumption — blocks Phase 4 rollout, measured in Phase 1.
- Q3 (spec §17): TTL per surface — blocks Phase 2 constants.
- Q4 (spec §17): alert rail in this delivery or the next — blocks Phase 5.
