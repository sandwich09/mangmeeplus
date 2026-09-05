# Agent Memory: auto-register-flow-b-p2-fixes

Status: IMPLEMENTED and REBASED onto `codex/flow-b-p1-fixes` FINAL tip (636acd22, which sits directly on develop e37eb216). Round-2 review items F2–F12 applied. Not merged, no PR. P2 must merge AFTER P1: its "15 ครั้ง" free-trial copy is only true with P1's `SIGNUP_TRIAL_TIER`.

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
- Mutation pass: 32 reverts across both rounds (22 + F2/F3/F4/F5/F6a/F6b/F6c/F8/F9/F10), every one
  re-reddened its test on the rebased head. Three gaps it found were closed first (username rule untested, received-page copy unasserted, and a queue guard that matched the load-more call as well as the first page).
- Not run: any real database, SES send, or browser session. The 390px checks are source/render assertions, not screenshots.

## Round 2 (review of 0c69c791)

- **F2** — the approve dialog refused OTHER whenever free text existed, but every Thai answer maps
  to OTHER, so a genuinely-other shop ("ร้านตัดผม") could never be approved. `approveBlockedOnCategory`
  now blocks only until the reviewer ticks "ตรวจแล้ว เป็นอื่น ๆ": the tripwire still gets a decision
  rather than a default, and the honest answer stays reachable.
- **F3/F4/F5** — three untested branches got their tests: the use-case enum re-check (an unvalidated
  category must reach neither the column nor the audit row), `queueEmptyForReal` as a pure function
  (an empty screen with no count behind it is a failed load, not an empty tab), and the PROBLEM
  tab's predicate including abandoned provisioning runs so the tab and its count agree.
- **F6** — `hasMailExchanger` collapsed NXDOMAIN and a timed-out resolver into "no MX", so a DNS
  blip accused a correct address of a typo AND (because the form rotates its key on a definite
  rejection) left an orphan RECEIVED row holding name, address and phone. Only
  `ENOTFOUND`/`ENODATA`/`NXDOMAIN` reject now (422, key rotates); everything else is
  `ServiceUnavailableException('email_domain_check_unavailable')` — 503, key kept, nobody blamed.
  Retention: `sweepAbandonedIntake` deletes RECEIVED rows older than 7 days (`companyId: null`
  guard) on the existing 15-minute timer, last so it cannot skip work a customer waits on.
- **F7** — `WIRING.md` §8 item 2 and the `auto-register-flow-b.md` follow-up struck as Closed.
- **F8/F9** — the free-trial line is hidden on REJECTED / PREPARING_FAILED / EXPIRED, and PREPARING
  asks for a refresh rather than promising a page that nothing polls will update itself.
- **F10** — the queue cursor carries the ordering VALUES (base64url `createdAt|id`), not a row id:
  Prisma's row cursor is resolved against the same filtered query, so a row that left the tab
  between pages answered with an empty page and stranded the tab until reload. A corrupt cursor is
  the first page.
- **F12** — `force-dynamic` on `/signup/status/[requestId]`, like its siblings.

## Rebase onto P1

One conflict, resolved as directed: the web-form approve takes P1's transactional
`core.advance(…, { data, alsoInTransaction })` form with `...reviewedCategory` folded into its
`data` — the separate `prisma.update` is gone, so the reviewer's category commits with the state
and the letter or not at all. Two follow-on fixups: the R10 tests now assert that transaction's
`data` instead of a second update, and the F6 outcome logic sits inside R08's RECEIVED-only branch
with the transient throw BEFORE the write, so a retry resumes from RECEIVED as R08 intends.

## Rebase onto P1's final tip (c9617c93)

Five conflicts, all content-preserving:

1. `signup.logic.spec.ts` imports — union of P1's `PLAN_TIER_PRESETS`/`SIGNUP_TRIAL_TIER_KEY` and my
   `PUBLIC_SIGNUP_STATUS_KEYS`.
2. `signup-admin-queue.use-case.ts` approve branch — P1's `if (lineOa || retryingProvisioning)`
   (their F2 retry) kept, my `chosenCategory`/`reviewedCategory` computed above it.
3. Same file, the transaction — P1's F8 in-transaction audit kept, with `...reviewedCategory` in
   its `data` and `businessCategory: chosenCategory` in the audit metadata. One transaction carries
   state, approval facts, the letter AND the evidence.
4. `signup.logic.ts` / `SignupPage.tsx` / `SignupWelcomePage.tsx` / its spec — my fuller free-trial
   copy wins as directed (the four cards stay deleted), but keyed off P1's `SIGNUP_TRIAL_TIER_KEY`
   rather than a hardcoded `FREE_TRIAL_15`, and `SELECTABLE_OFFER_KEY` takes P1's `'FREE_TRIAL'`.
   The welcome line keeps my "what happens after" clause on P1's F1 sentence.
5. Coordination, not a textual conflict: P1's F2 moved `PROVISIONING_FAILED` into the all-source
   `QUEUE_STATES`, so my `PROBLEM_STATES`/`LINE_PROBLEM_STATES` split and the PROBLEM count moved
   with it — otherwise a Flow B provisioning failure showed in ALL, was counted in PROBLEM, and was
   missing from the PROBLEM list.

Round-2 review blocker, fixed in the same pass: `SignupQueueQueryDto.cursor` still bounded the
cursor at 64 characters while F10's `createdAt|id` cursor is 67, so every "โหลดเพิ่ม" was a 400
from the global pipe. Bound raised to 128 and pinned by a test that round-trips a real
`encodeQueueCursor` value through the real DTO under the real `GLOBAL_VALIDATION_PIPE_OPTIONS`.

## Final rebase onto P1's closing tip (636acd22)

P1 rebased itself onto a newer develop, so `c9617c93` stopped being an ancestor and a plain
`git rebase` tried to replay P1's own commits. `git rebase --onto 636acd22 c9617c93` replays only
this branch's 15. One dropped as already upstream (the comment reword P1 had taken).

Conflicts, all content-preserving:

1. Import lists in `SignupPage.tsx` and `signup.logic.spec.ts` — union with P1's `offerWarmupNote`
   / `SIGNUP_TRIAL_WARMUP_SLIPS`.
2. `local-console-auth-mailer.adapter.ts` (from develop) — keep develop's `sendSupportRequestNotice`
   AND my widened `buildUrl(pathname, token, signupRequestId?)`.
3. `signup-claim-email-internal.controller.ts` (from develop) — keep develop's
   `sweepExpiredSupportRequests` + `purgeSettledSupportRequests` AND my `sweepAbandonedIntake`,
   which stays last so a retention failure cannot skip work a customer waits on.
4. The approve audit — P1's F16 split (`signup.request.provisioning_retried` for a retry) kept,
   with my `businessCategory` in its metadata on both actions.
5. The trial copy — my free-trial lines, then P1's F17 warm-up sentence. The offer cards it hung
   off are gone, so `offerWarmupNote(card)` became the `SIGNUP_TRIAL_WARMUP` constant, rendered in
   `TrialNotice` under the monthly number it qualifies. P1's F17 assertion moved with it, and a
   second assertion was added because "the constant exists" and "the sentence reaches the screen"
   are different claims — deleting the rendered line had stayed green.

`signup-pages.qa.spec.ts` keeps P1's entries plus my `signup.logic.ts` / `SignupChrome.tsx` and the
directory assertion. `package.json` and `ci.yml` are untouched by this branch — P1 owns both.

## Next

- ~~Rebase onto the sibling `codex/flow-b-p1-fixes` head.~~ **Done** (3d5cd03f). The overlaps it touched: `provision-signup.use-case.ts` (their `planTier`, my `businessCategory`, adjacent lines in the same `createCompany` call), `signup-admin-queue.use-case.ts` (their approve/reissue transactions, my `list` and the approve-time category write), and the `external-signup` web pages (their public-fetch credentials/CSRF and the claim route's POST, my copy and state changes).
- Left out on purpose: spec/docs reconciliation for P10 (the review's "Docs drift" item), and any change to what the server provisions — both belong elsewhere.
