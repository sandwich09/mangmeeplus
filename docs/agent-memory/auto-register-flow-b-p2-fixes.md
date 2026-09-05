# Agent Memory: auto-register-flow-b-p2-fixes

Status: IMPLEMENTED on `codex/flow-b-p2-fixes` (from `origin/develop` 9170415114d9974ccbf8e71df2208275bfc49105). Not merged, no PR. Needs a rebase onto the sibling `codex/flow-b-p1-fixes` head before it goes anywhere.

Owner: thawatchai

Scope: the P2 findings and the whole "UX และ wording" table of `docs/agent-memory/auto-register-review-2026-09-05.md` (R07, R10, R11, R12, R13), plus the Owner package decision of 2026-09-05. P1 (R01–R06, R08, R09) belongs to the sibling branch and is deliberately untouched here.

## Decisions

- **R07** — the page kept ONE idempotency key for the whole form while `submit-company-signup.use-case` receives durably *before* the MX lookup, so a corrected address under the same key answered `external_signup_payload_conflict`. The key is now replaced after a DEFINITE validation rejection (400/422) only; every unknown outcome (network, 5xx, 429) keeps it, so a retry after a timeout still cannot open a second application. `email_domain_has_no_mx` gets Thai copy under the email input with focus, and a local validation failure focuses its first error in submit order.
- **R10** — no text heuristic. `businessType` is free text and the PDPA health tripwire reads a closed enum, so the reviewer picks `businessCategory` on the approve dialog: defaulted to the server's mapping, REQUIRED when the mapping answered OTHER and free text is present, re-checked against the enum at the controller AND in the use case, stored on the request, and preferred over the mapping at provisioning. A stored value the enum no longer knows degrades to OTHER rather than arming anything.
- **R11** — `PublicSignupStatusKey` gains `PREPARING`, `PREPARING_FAILED` and `EMAIL_FAILED` (additive; the union is now a `PUBLIC_SIGNUP_STATUS_KEYS` const so both sides can be exhaustive). EMAIL_VERIFIED/PROVISIONING stop answering READY, PROVISIONING_FAILED stops answering CHECKING, EMAIL_FAILED stops answering AWAITING_CLAIM. A queued resend reads as queued. Transient load failures on the status and claim pages get a retry and are never reported as a dead link; an availability outage has its own notice, distinct from "signups are closed".
- **R12** — a successful submit `router.replace`s to `/signup/status/<id>` (the route already existed) and the status page can copy that URL. The claim mail carries the request id beside the token (`?token=…&r=<id>`, optional field on `AccountClaimEmailInput`), so a spent link can offer the status page instead of a login the applicant has no password for. The resend hint only appears where resend exists.
- **R13** — the tab is a server-side predicate (`queueWhere`), the page is a keyset page (`createdAt asc, id asc`, `take: pageSize + 1` probe, `cursor` + `skip: 1`, default 50 / max 200), and the counts come from one `groupBy(['state','source'])` plus one `count` for abandoned provisioning. `filterSignupQueue` is deleted — filtering in the browser could only ever filter the page that arrived. New `ARCHIVED` tab (REJECTED/SUSPENDED/EXPIRED): decided applications appeared on no list at all.
- **Package copy (Owner 2026-09-05, mid-task)** — self-signup stopped selling a tier. The four priced cards and the plan picker are gone; the form, received page and status page carry one free-trial line quoted from `PLAN_TIER_PRESETS.FREE_TRIAL_15`, plus what happens after it, with no auto-charge implied. `requestedOfferKey: 'PRO_TRIAL'` is still SENT — it is the server's allowlist key and what the admin queue displays; the applicant is simply shown no choice. The server-side plan preset is the sibling P1 agent's change.

## Open questions

- Whether `requestedOfferKey` should become a free-trial key once the sibling's provisioning preset lands. Left as-is here: changing it is a contract change, not a copy change.
- The claim page reads the status id from `?r=`; only the claim mail sets it today. A link forwarded without the param still shows the unusable-link view with no status button (by design — nothing else knows the id).

## Artifacts

- Contracts: `packages/contracts/src/external-signup.ts` (`PUBLIC_SIGNUP_STATUS_KEYS`, `AdminSignupQueueDto.nextCursor/counts`, `AdminSignupDecisionBody.businessCategory`, `AdminSignupQueueItemDto.businessCategory`)
- API: `signup-admin-queue.use-case.ts`, `provision-signup.use-case.ts`, `account-claim.logic.ts`, `signup-claim-email.service.ts`, `system-signup-request.controller.ts`, `auth-mailer.port.ts`, `ses-auth-mailer.adapter.ts`, `local-console-auth-mailer.adapter.ts`
- Migration: `apps/api/prisma/migrations/20260905180000_signup_business_category/migration.sql` (nullable TEXT column, additive)
- Web: the five `external-signup` pages plus `signup.logic.ts`, and `SignupQueuePage.tsx` / `signup-queue.logic.ts` / `signup-requests.api.ts`
- New web specs (glob-matched, so `package.json` is untouched): `SignupPage.qa.spec.ts`, `SignupStatusPage.qa.spec.ts`, `ClaimAccountPage.qa.spec.ts`, `signup-copy.qa.spec.ts`, `signup-mobile.qa.spec.ts`

## Verification

- API fixed list: 6526 tests / 1321 suites / 6427 pass / 0 fail / 99 skipped
- Web: 1507 tests / 322 suites / 1507 pass / 0 fail
- `pnpm -r typecheck` exit 0; `apps/web` `next build` exit 0 (contracts built first); `prisma validate` OK
- `node infra/security/sync-production-maintenance-release-pins.mjs --check` → `status=current` (no touched file is pinned)
- Mutation pass: 22 reverts, every one re-reddened its test. Three gaps it found were closed first (username rule untested, received-page copy unasserted, and a queue guard that matched the load-more call as well as the first page).
- Not run: any real database, SES send, or browser session. The 390px checks are source/render assertions, not screenshots.

## Next

- Rebase onto the sibling `codex/flow-b-p1-fixes` head. Expected overlaps: `provision-signup.use-case.ts` (their `planTier`, my `businessCategory`, adjacent lines in the same `createCompany` call), `signup-admin-queue.use-case.ts` (their approve/reissue transactions, my `list` and the approve-time category write), and the `external-signup` web pages (their public-fetch credentials/CSRF and the claim route's POST, my copy and state changes).
- Left out on purpose: spec/docs reconciliation for P10 (the review's "Docs drift" item), and any change to what the server provisions — both belong elsewhere.
