# Agent Memory: Stripe / Postmark implementation

Status: IN PROGRESS; owner resumed after the latest pause with “ทำต่อ”; owner resumed with “ทำต่อ”. Owner asked progress: communicated approximately70% of total scope (estimate, not a calculated coverage metric). Latest combined161 PASS belongs to ef7dd3d9; delivery-read/error-UX correction d422ab1e has focused65 + Messaging8 + Thai/error54 PASS (overlap), final API/web typechecks PASS, and is pushed with CI34827265627 FAILED (unowned Messaging resolver test). No merge or deployment.
Owner: Codex / repository owner.
Scope: Implement approved package/payment/Postmark/Admin C01–C08/web/LINE specs, prove simulated E2E, then merge develop and main in BOTH repositories after green CI. Keep live deployment separate.

## Decisions and constraints

- Start and charge immediately on confirmed purchase, with no trial-day carryover.
- Same full package adds its quota now and its duration after max(paidThrough, paidAt). Annual quotas: Starter360, Basic600, Pro1200 upfront; no monthly paid reset. Pro annual with8months left plus another annual purchase gives1200 more receipts and20months remaining.
- Upgrade charges the prorated difference across prepaid segments, starts immediately and keeps expiry. Downgrade takes effect at the purchased boundary, with retained branch/member selection and no deletion.
- Receipt-only offers HIDDEN and SALES CLOSED everywhere. Enterprise1999 and SYSTEM ภ.ง.ด.53/50ทวิ Coming soon; no checkout. Existing manually entered external tax documents remain supported.
- Signup:7menus (6parents/17keys), FREE_TRIAL_15,1branch,2members including OWNER,15receipts per Bangkok month,30days from provisioning. Retain manual approval/eligibility/account-link rules.
- VAT OFF by default;7% inclusive/exclusive, issuer, versioned preview and independent approval through Admin. Stripe customer Invoice/Receipt; Postmark auth/claim/notification mail with no duplicate fiscal PDF.
- Previously paid renewal failure:7day grace with old rights/remaining receipts, then suspend and stop future Stripe collection. Cancellation at paid boundary. Refund/dispute/old debt require manual review.
- Owner permits admin merge when CI passes and Developer Chrome provider access. NO DEPLOY. No real recipient sends/live charges in local tests.
- No subagents. Ponytail full read from current .agents/skills/ponytail/SKILL.md (old user path is stale). No package.json edits. Untracked apps/web/CLAUDE.md and original dirty mangmee_web checkout stay untouched. Another task changed docs/runbooks/cloud-environment-operations.md and created docs/agent-memory/uat-power-2026-09-14.md during this run; preserve and exclude both from this commit.

## Current repositories / CI

- Root: /Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus, branch codex/stripe-postmark-implementation-20260912, draft PR558 to develop.
- Latest HEADd422ab1e pushed; CI34827265627 IN_PROGRESS at initial read. PR558 body updated with focused proof and remaining scope. This supersedes the failed ef7 checkpoint below.
- Root HEADef7dd3d9 (Messaging runtime publication) pushed; CI34824733275 FAILED at pnpm test: web Thai error coverage found8 new LINE codes missing from the common message catalog. API/HTTP/browser steps did not finish; do not claim this CI green. Add the reviewed actionable translations without exempting the coverage guard. Previous ac1b3b8e CI34807517926 FAILED in email-verification browser return (profile email timeout): fixture navigated away while /login redirect was pending. It now waits for the final authenticated dashboard before opening profile; local6 PASS. Original-invoice d3ac0c83 CI34805765742 PASS. Previous CI34803284452 at6da65148 FAILED in signup browser fixture: click raced the actual account-security legal redirect. The corrected fixture now lets the gate finish, accepts legal, then skips LINE; local signup8 PASS. Do not rerun the known old revision as a fix.
- Previous root7ca2d7a8 C07 missing-event discovery: CI34801493799 PASS.
- Isolated marketing: /Users/thawatchai/Project/MangmeeYungYuen/mangmee_web-stripe-postmark-20260912, same branch, draft PR2 to develop. HEAD969e4c0; CI34824750232 PASS.
- Both drafts remain open; authorized develop/main merges are still owed after full implementation/review/green CI. Read-only no-deploy GitHub surface preflight is recorded; refresh before eventual merges.

## C03 verified checkpoint d3ac0c83

Exact original-invoice apply retry is implemented in contracts/DTOs/Admin safe25+1 list/detail, source-bound preview/submit/worker, original operation retry/cancel and UI result→invoice→company return. It reuses the existing account lease, strict paid evidence and entitlement writer. Another applied invoice or COMPLETED attempt cannot certify a HELD target. Already-applied targets require no provider I/O. Legacy targetless commands can be read/cancelled and lead to original invoice selection.

Operation result/review-case/audit commit with the live operation lease. Independent paid application may succeed under the account lease after an operator worker loses its operation lease; the stale operator cannot certify success or resolve its case. Only its replacement observes the original grant. Current operator membership is separate from the target expired customer; scoped non-member operators are tested. Observation timestamps do not invalidate a reviewed invoice; material source changes do. Shared financial observation/case/audit is used for subscription and repeat evidence; missing refund/dispute fields are rejected.

Found and fixed: Next dynamic-slug conflict, new Admin route accidentally selecting the target company as actor membership, stale list capability buttons, malformed financial defaulting, and signup browser fixture navigation race. No security gate or timeout was relaxed.

Verification: focused8 new HTTP/PG/390px browser groups PASS (15 with existing purchase prefix); billing/DTO29 and actual PostgreSQL35 PASS; API typecheck PASS; pins/check regression PASS. Full current combined158 HTTP/PG/Next/Chromium/isolated-marketing PASS, including the final list-capability guard. Signup8 local rerun PASS after the CI fixture fix. Final web/API typechecks PASS; evidence recorded. Committed/pushed asd3ac0c83; CI34805765742 PASS.

## C03 repeat recovery increment (locally verified)

Spec+plan updated first. Added billing-repeat-apply-smoke.ts and wired the original one-time paid repeat journal after lost schedule update into real Admin invoice preview/submit/UNKNOWN/retry. The helper tests mismatched Checkout invoice refusal, lost resume response, exact original grant/time, preserved purchase/invoice counts and mobile permanent-operation→invoice→company return. Main flag BILLING_REPEAT_APPLY_ONLY exits after repeat and existing generic Admin command checks; CI browser line added. Generic RECONCILE case detection/resolution/result/audit now share the final operation lease/CAS transaction. Repeat smoke64 overlapping groups (3additional repeat recovery groups), API typecheck and billing/DTO20 PASS; mobile capture inspected. Inspect /tmp/mangmee-billing-http-smoke.log and /tmp/mangmee-repeat-apply-api-typecheck.log. Primary158/source atd3ac remains historical for this WIP. Evidence in repeat-apply-result.json; committed/pushed asac1b3b8e; CI34807517926 failed at the separate email browser return; corrected fixture and local6 PASS in current increment. Frontend source unchanged fromd3ac; generated next-env restored. No merge/deploy.

## C07 Messaging credential increment (committed/pushed ef7dd3d9; CI pending)

Detailed controls spec+plan written first. Implemented uncached common resolver, explicit PlatformLineCredential publication/inbound-observation columns and local migration. All15 shared Messaging consumer classes now inject the resolver;82 direct test constructors updated with an explicit unit-only environment fixture. Auth notices catch unavailable config after their account mutation; expired outbound tokens do not discard signed incoming events. Existing ENV config is used only before an explicit publication. Channel ID remains pinned; LINE Login/LIFF and channel migration remain closed.

Messaging-only Admin metadata/read/write now checks fresh global SYSTEM_ADMIN+registered permission, current session/password/credential version, bounded provider token verification (short/long-lived), expected revision, stable rotationId/input hash, atomic encrypted publication/audit and same-request response recovery. No provider changes/revoke/export. UI now shows publication/token observation/inbound signature and readable/expired/corrupt credential separately; inputs only in component memory, acknowledgement/current-password/read-refresh/back/recovery. Permission and existing SystemHeader link enabled in ef7dd3d9; not deployed.

Affected source regression954 PASS at the preceding runtime checkpoint; current focused resolver/publication/notification37, auth144, permission/redaction76 and PostgreSQL billing35 PASS. LINE8 actual HTTP/PG/Next/390px PASS: same payload/retry key survives token publication; duplicate dispatch does not resend; foreign channel skips; two simultaneous HTTP saves reach the provider barrier and exactly one publishes; exact winner replay and role revocation fences pass. Corrupt Messaging config must not break independent account/employee LIFF pages; moved their optional bot-info lookup inside the existing best-effort catch and proved both HTML200 with an empty optional OA URL. Final API/web typechecks PASS.

Email6 PASS after awaiting the final authenticated landing before opening profile. Repeat/Admin64 PASS after awaiting the permanent operation URL and its unique heading before submit. The failed combined run and first diagnostic rerun were not rate limited: API202 was accepted, but the fixture clicked the departing company's still-visible control. Removed the speculative429 retry branch; the corrected fixture asserts202/QUEUED and records safe UI/DB diagnostics if it fails. No application guard or timeout was relaxed. Full combined browser regression161 PASS on the final runtime sources; historical158 archived and300 current source hashes recorded. Evidence includes line-runtime-credentials-result.json, email-verification-ci-recovery-result.json and repeat-admin-ci-recovery-result.json. No merge/deploy/native changes.

Next bounded runtime-read gap: BillingNotificationsService.reviewLine currently lets a resolver503 fail the entire delivery read when a published credential is corrupt/expired. Project that condition into its existing LINE_CONFIGURATION_MISSING blocked reason so support can still inspect the original delivery and return to configuration repair; keep final outbound I/O fail-closed. Verify real Admin delivery list/detail and recovery after a corrected publication.

Correction in progress: read-time readiness projection and actionable existing panel text implemented. The existing delivery recovery smoke now injects corrupt→expired→valid publications in its isolated PostgreSQL DB, asserts readable scoped list/detail, denied preview, unchanged journal/no sends, mobile reload and exact original accepted retry under the published token. BILLING_CONFIG_ONLY+BROWSER is running. The smoke bootstrap now creates a fresh synthetic encryption key itself: the previous local run inherited this key, while the CI environment does not supply it. This was discovered separately from the actual Thai-coverage CI failure, before the Messaging step could run.

The first configuration-focused run completed its delivery checks then failed provider-event browser preview; diagnostic repetition proved actual HTTP429/BILLING_RATE_LIMIT/retryAfterSeconds54. The shared operation panel hid that actionable wait behind a generic sentence. It now uses the existing safe apiErrorMessage, and the fixture checks the real wait/no created command/retained reason before one same-input retry. No increased limit, cleared limiter or timeout relaxation. Common Thai/error-redaction54 PASS; API typecheck PASS before the latest fixture-only diagnostic/retry edits. Configuration browser rerun underway; no current combined PASS yet.

Final focused result:65 HTTP/PG/Next/mobile groups PASS (includes the actually observed429/no-command/retained-input/wait path); Messaging8 rerun PASS with generated synthetic encryption key. Both processes ended and generated next-env restored. Source300 drift check empty. New delivery-config-recovery-result.json and refreshed line-runtime-credentials-result.json record these exact sources; prior ef7 LINE result archived. Screenshot inspected: readable390px and no horizontal overflow. Common Thai/error-redaction54, web typecheck and pins check PASS. Final API typecheck is rerunning after the diagnostic/retry fixture changes. No full combined rerun claimed for this correction; combined161 remains the previous checkpoint. No local Next/browser smoke remains running.

Owner's Stripe screenshot question2026-09-14: inspected the matching Chrome Sandbox tab and used its Exit sandbox action to read the related LIVE account's Account status. LIVE visibly reports no active tasks and Payments/Payouts/PromptPay payments ACTIVE; its home shows zero balance. The overdue business-verification/payout-paused task is visible in the separate Sandbox from the screenshot, whose transaction balances are simulated. Answer delivered in Thai; no verification upload, provider configuration change, credential reveal, charge or payout performed. Left the existing tab on LIVE Account status as the reviewed result; future implementation must still explicitly select Sandbox/test credentials. Do not imply this read proves Mangmee integration or deployment readiness. Reference: https://docs.stripe.com/sandboxes.

Remaining recipient-channel audit: legacy password-reset, employee temporary credential, signup-admin and partner-owner notices; ordinary notification fallback is removed and proved here. Account state and LinkLineIdentity/ExchangeLineToken still accept legacy-channel rows; same-user relink keeps that channel. A separate correction must include a proof-backed repair path and distinguish linked identity from current Messaging delivery, so strict outbound checks do not create a dead end. Use the existing AppSidebar LINE menu/OAuth action: /companies/:id/settings/security remains disabled by the owner and redirects to dashboard; do not enable the unused AccountSecurityPage for this work. LINE IDs are provider-scoped (official docs rechecked), whereas our providerChannelId pins the approved local relationship; never silently remap arbitrary foreign-channel rows. See current research note.

Further source review corrects the proposed repair UI: line-self-link-spec.md §3/§6 explicitly keeps an already-linked sidebar row disabled; re-link/unlink remain Partner Detail Admin actions (owner2026-09-01). Do not enable self-relink. Existing PartnerMemberLineLinkTokenUseCase→CompleteEmployeeLineLinkUseCase supplies the admin-issued72h QR, current LINE proof and allowReassign=true; that is the repair lane to extend. Same-user ACTIVE QR relink currently also leaves linkedAt older than token.usedAt, so its USED-token response-recovery check can refuse the original same identity. Review canonical-vs-known-legacy lookup and ambiguous/foreign rows; a canonical UNLINKED/DISABLED tombstone must not resurrect an older active legacy alias through login fallback. Review existing unlink/sever owner CAS before changing bindings. These are findings for a separate spec-first correction, not implemented/accepted here.

## Earlier verified coverage

- Primary161 combined result/source now identifies the Messaging/repeat/navigation checkpoint;158 and150 are archived. Discovery7 includes durable fixed-window pagination, webhook race, stale lease, current platform authorization, retry/backoff/resume/cancel, bounded caps and no financial mutation. Daily/historical/config drift is not included.
- Signup8: real form/manual approval/Postmark UNKNOWN lookup/single original claim/BFF session/default entitlement, fragment/legacy proof, expired resend, skip LINE/legal, real local receipt bytes with OCR503/manual recovery, logout/login return. No native mail or OCR success claimed.
- Email verification6: explicit click/fragment+legacy, lost response→profile, stale/single-use/expiry/ACTIVE/unique email transaction fences and stale resend. Auth93/web1703 at6da checkpoint, API/web typechecks PASS. Separate source receipt; not added to primary150.
- Paid initial/repeat/upgrade/downgrade/restart/cancel/resume, mapped financial history, quotas, scoped support/cases/notifications, policy/VAT approval and retained draft/impact lists are included in the combined evidence.
- LINE current actor/source/read proof and durable exact queued payload/UNKNOWN retry: module1287 at its recorded checkpoint. Full intake/draft/live-capture/AP matrix and native delivery not yet complete. Historical test counts overlap and must not be summed.

## Open questions

Owner has not answered the earlier question whether to add verified-email Postmark password recovery alongside LINE. Approved legacy spec intentionally parks email RequestPasswordReset/ConfirmPasswordReset endpoints; /forgot-password uses LINE. Keep email reset closed until an answer. Explicit verification is separate and already implemented. Continue other authorized work.

## Remaining implementation

- C03 aged UNKNOWN/compensation and recorded support outcomes. Generic RECONCILE case transaction correction is locally verified in the increment above.
- C05/C06 detailed capacity rollouts/cohorts/scheduling, global SLA/escalation publication and complete runtime provider readiness/configuration.
- C07 daily automatic scans, durable historical invoice coverage, configuration/settlement drift and bounded bulk recovery.
- C08 exceptions/debt/refund/temporary override/revoke/expiry/compensation/export/privileged documents under approved policies.
- Full Postmark monitoring/retention/mail operations/EM09 identity variants; email reset only after decision.
- LINE source-derived intake/draft/live-capture and full AP21–24; remaining recipient-channel lookups, Login/LIFF and rich-menu/runtime webhook configuration. Messaging-only runtime publication is locally proved above; it does not change Login/LIFF or OA identity.
- Final exact-source verification, CI, review and authorized develop+main merges in both repositories. No deployment.

## Artifacts / reproduction

- [Evidence and source hashes](../evidence/billing-integration-2026-09-13/README.md), [controls spec](../specs/mangmee-billing-controls-spec-th.md), [controls plan](../plans/mangmee-billing-controls-plan-th.md), [package amendment](../specs/mangmee-billing-pack-amendment-2026-09-12.md).
- [Historical checkpoints](stripe-postmark-implementation-history-through-2026-09-14.md) preserve earlier decisions, commands and failures; their status paragraphs are superseded here.
- Local database only localhost15432/mangmee_billing_20260912 and Redis6379. Load .env +0600 /tmp/mangmee-billing-local.env via Node parseEnv without printing credentials.
- /tmp/mangmee-run-billing-smoke.mjs asserts that DB, runs compiled /tmp/mangmee-postmark-api-build/scripts/billing-http-smoke.js and writes private /tmp/mangmee-billing-http-smoke.log. Compile SWC only after the prior smoke ends. Full browser: BILLING_BROWSER_E2E=1 and MANGMEE_MARKETING_DIR=isolated path. Focus: BILLING_APPLY_RETRY_ONLY=1. Separate signup/verification/discovery flags remain available.
- /tmp/mangmee-apply-retry-focused.log, /tmp/mangmee-signup-ci-race-fixed.log, /tmp/mangmee-apply-billing-regression.tap, /tmp/mangmee-apply-pg.tap; screenshots in /tmp/mangmee-billing-browser-evidence. Do not copy whole Next log: legacy proof URLs can be present.
- /tmp/mangmee-invoice-retry-api-typecheck.log; final web typecheck pending. Once Next stops, restore only generated apps/web/next-env.d.ts. No smoke/typecheck process remains active.

Final API typecheck after all fixture edits PASS (/tmp/mangmee-delivery-read-api-typecheck-final.log); no local test process remains active. Source hashes unchanged and git diff --check PASS.

Next: delivery-read/rate-limit/Thai-message correction committed/pushed d422ab1e; new CI34827265627 is running. Both draft PRs remain open. Implement the spec-first legacy LINE repair via existing Admin QR, preserving disabled self-relink, before remaining controls. Continue independent implementation while CI runs; do not ready/merge the draft solely because a checkpoint passes.

## Paused by owner — 2026-09-14

Owner said “plause ก่อน”; stop implementation and testing. No merge or deployment. Preserve the uncommitted canonical LINE binding fix and unrelated task files.

Latest read-only CI snapshot: d422ab1e CI34827265627 COMPLETED/FAILURE in Typecheck and Test; source/config/secret/security/migration jobs passed. Failure details have NOT yet been inspected. Do not claim this checkpoint CI green or rerun it blindly.

Uncommitted correction: ExchangeLineToken canonical identity lookup now observes ACTIVE/UNLINKED/DISABLED before permitting legacy fallback; canonical inactive rows cannot resurrect an older ACTIVE alias. Auth/callback59 tests PASS; dedicated local PostgreSQL1 test PASS (explicit isolated DB), with the PG command added to CI. No typecheck after these edits yet. Logs /tmp/mangmee-line-tombstone-auth.tap and /tmp/mangmee-line-tombstone-pg.tap.

Root-cause audit remains open: ProcessLineWebhookUseCase.resolveLineIdentity around2869 has the same status-filtered canonical lookup and unrestricted fallback. Its resolveSupportAsker caller around2019 passes no channel. Inspect the existing event/config channel and fixtures; fix all affected AI resolution paths while preserving the approved Admin QR legacy repair lane and disabled self-relink. No AI code edit was made before pause. Existing QR recovery also needs subject-bound USED-token proof and owner/version fencing; those are findings, not implemented.

On resume: inspect CI failure, complete scoped LINE correction with spec/plan and actual checks, update evidence, then continue remaining approved scope. No local smoke or typecheck was started during the final read-only snapshot.

## Resumed LINE canonical binding correction — 2026-09-14

Owner resumed “ทำต่อ”. Confirmed CI34827265627 failed the unchanged spec-suite ownership guard: common/config/line-messaging-credentials.service.spec.ts was not in a maintained runner. Its six assertions now live in the existing default system-line-push.spec.ts entry; no package.json edit or guard exemption.

Canonical inactive LINE bindings now stop legacy fallback in login and the shared AI resolver. Support keeps the event channel and older queued input uses configured Messaging channel; production with neither refuses before identity read. Text/media/legal/support entry and final delivery revocation regressions included. Affected source suite661 PASS (0fail/0skip); actual isolated PostgreSQL login1 PASS. These are overlapping source/PG checks, not a new combined HTTP/browser run. First typecheck found a fixture type missing ExternalIdentity.status; annotation corrected and final typecheck pending. Pins current/diff check PASS. Logs /tmp/mangmee-line-binding-resume.tap, /tmp/mangmee-line-tombstone-pg.tap, /tmp/mangmee-line-binding-api-typecheck.log.

Next: finish final typecheck/evidence/commit for this bounded fix, then implement Admin QR legacy repair with exact claimed subject, stale-unlink fences and account/recipient readiness together. Do not claim all C07 or full task complete from this increment.

Final API typecheck after the fixture annotation PASS; source661 and PostgreSQL1 proofs recorded in line-canonical-binding-result.json. Preparing bounded canonical-binding/CI-runner commit. No merge/deploy.
