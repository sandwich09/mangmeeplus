# Agent Memory: UAT LINE chat NOGROUP — 2026-09-17

Status: Phase A (ledger lifecycle) IMPLEMENTED AND MERGED to `develop` + `main` (PRs #600 / #601) together with phases B–F of the same spec; NOT deployed — UAT keeps the symptom until a build containing Phase A is deployed under the UAT protocol. Full state and next steps: [delivery summary and handoff](line-intake-cost-and-budget-receipt-behavior-2026-09-17.md#delivery-summary-and-handoff--2026-09-18). Earlier status: Diagnosis and expanded A–E remediation spec/plan complete. Owner requested all cost/budget/receipt fixes in the existing NOGROUP spec and chose separate CHAT/OCR caps. Implementation, tests and live activation remain pending. Production failures at 20:29 KST are confirmed as company monthly AI budget exhaustion; exact screenshot actor identity remains unverified. No application fix, budget adjustment or cloud mutation performed.
Owner: thawatchai + Codex
Scope: Diagnose UAT/Production reports and prepare one spec/plan covering ledger lifecycle, budget refusal/receipt handling, intake cost, AI Budget visibility and separate CHAT/OCR caps.

Decisions:
- Read the cloud operations runbook before inspecting live UAT. Used the existing non-root `mangmee-kamal-uat` profile and enrolled SSH host keys.
- Both enrolled EC2 hosts are running. All three serving app containers advertise source `1468ea7088a961af81ebce173df9a5d4028c96bd`, operation `20260917T103812Z-23d4190c`. This is runtime readback, not signed release acceptance.
- The webhook was accepted at 2026-09-17T12:12:00.439Z (19:12 Bangkok), HTTP 200. At 12:12:01.554Z, `LineAiLedgerService` logged `ai.line.ledger.read_failed`: Redis `NOGROUP`, missing the chat stream or consumer group `lineai-turn`.
- The dispatcher logged `line_ai_marker_unavailable`, delivered the fallback, and ended with `status=marker_unavailable`, `errorCode=CONSUMPTION_MARKER_UNAVAILABLE`, `terminalClass=failed_terminal`. Correlation request ID: `be054fa4-5765-4f27-b405-720e8a962fe4`; webhook event: `01M2QMFSMRRCY9SAP29A4EKAXB`.
- Exact deployed source confirms `openWaitingUser()` calls `XPENDING` before any stream/group initialization and wraps every read error in `ConsumptionMarkerUnavailableError`. Stream/group creation exists only in `append()`, which this text path never reaches after that error. The request fails before AI routing/model invocation.
- The earlier package card originates from billing notification `billing.package_updated`. The observed chat failure is in ledger pre-processing; the logs do not identify package entitlement denial as the cause.
- Do not label this as provider downtime or guarantee that resending fixes it. Missing stream/group handling needs remediation while genuine store/marker failures must remain fail-closed.

Open questions:
- Whether this specific stream had expired, had never been initialized, or existed without its group is not established by the NOGROUP log alone. The configured default TTL is 86,400 seconds; expiry is a possibility, not a verified cause.

Artifacts:
- `docs/specs/line-ai-ledger-lifecycle-remediation-spec-th.md`
- `docs/plans/line-ai-ledger-lifecycle-remediation-plan-th.md`
- `apps/api/src/modules/line-ai/application/line-ai-ledger.service.ts` (`openWaitingUser`, `append`).
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (marker-unavailable fallback before gateway call).
- Bounded raw logs retained only in ignored, private `.env.kamal/uat/diagnostics/line-chat-20260917/` (12:08–12:14 UTC); private identifiers are not copied here.

Verification:
- AWS STS non-root identity and exact EC2 instance/IP/state readback passed.
- Strict-host-key SSH `docker ps` and bounded `docker logs` reads succeeded for API, AI Gateway and workers. AI Gateway emitted no logs during the captured interval.
- Compared the ledger path against `git show 1468ea7088a961af81ebce173df9a5d4028c96bd:apps/api/src/modules/line-ai/application/line-ai-ledger.service.ts`.
- No synthetic LINE message, Redis mutation, database mutation, service restart, deploy or test run was needed for this diagnostic request.

Next:
- Implement only when requested, using the expanded A–E spec/plan. Ledger absence handling retains fail-closed corruption/store/marker boundaries; budget/reporting/cost/split work is now part of the same planned delivery. No automatic group reset/replay is in scope.
- Production: monthly AI budget denial is now confirmed for the matching 20:28–20:29 KST sequence (details below). Any budget increase is a separate authorized administrative change; the UAT ledger fix must preserve this budget gate. No need to ask for the already supplied timezone again.

## Production read-only follow-up and specification — 2026-09-17

Product / architecture decisions:
- Direct free text must not require tapping the greeting tile first. The public tile uses a deterministic greeting/resume path and cannot establish AI health.
- The smallest remediation checks exact-key absence only after NOGROUP. Existing stream/group corruption does not authorize automatic replay or deletion. Durable clarification markers, source-state/permission checks, support pauses and other stores remain authoritative.
- FakeRedis currently returns empty pending state for a missing group; the plan requires faithful NOGROUP behavior and isolated real-Redis expiry/group-loss checks.
- No new dependency, package edit, database schema or live state change is required by this specification.

Production evidence:
- Existing `watchdog-bedrock` credentials resolve to non-root IAM user `watchdog-bedrock-dev` in the expected account. No root profile or permission change used.
- ECS Express active configuration, ECR tag and actual running task image digest agree: source `fc2838c4cb691033f41595c0d43587f10377d33c`, API digest `sha256:95faa147060b2c0aedc78d9460c41adf41d1c9b00c890479e29057f72464b87d`, task suffix `3ea062c2ef024284b23ae384ef5d5c9d`; `LINE_AI_LEDGER_ENABLED=true`, `PRODUCTION_SERVING_MODE=live`. Task is RUNNING, ECS health field UNKNOWN; neither field alone certifies end-to-end health.
- Exact source differs from UAT: Production's Redis read catch logs and returns `[]`; UAT's newer catch throws `ConsumptionMarkerUnavailableError`. Therefore the same NOGROUP log does not establish the same user-visible failure.
- Complete API log window 19:00–19:20 Bangkok (12:00–12:20 UTC), 2,888 events and empty next page:
  - 19:06:26.205 accepted event `01M2QM5KAHECTPY76WD36YMX1A`; 19:06:26.422 `staff_menu_talk`, terminal `delivered`, segment `command`.
  - 19:10:05.385 accepted free-text event `01M2QMC9BG3566MC26B8NV3GVQ`.
  - 19:10:06.433 ledger NOGROUP warning; request continued as the deployed source specifies.
  - Intake route 5,896 ms; gateway 6,110 ms; LINE delivery 180 ms. At 19:10:18.649, `casual_conversation`, two Bedrock calls, zero ERP tools, `deliveryResult=ok`; 19:10:18.655 `completed` / `delivered`, about 13.27 seconds after acceptance. Correlation request `63d54d6e-2b05-4de5-a928-6cb265d50f03`.
  - No failed LINE terminal event found in this complete window. Successful API delivery is provider acceptance, not proof that the person in the screenshot saw it.
- Earlier bounded page (18:30–before 19:00) contains `company_context_listed` delivered at 18:44:17.831 and `staff_menu_contact` delivered at 18:52:23.172. Do not infer the same actor or a support pause from those unrelated events.
- The screenshot is a forwarded report: its outer 19:05/19:06 times and inner undated 20:28 time cannot independently establish the failed-message date/time. User clarification was requested asynchronously; no answer yet. No account identity was inferred from the avatar/name in the image.
- CloudWatch Insights `StartQuery` was denied by the existing reader. A broad 48-hour filtered scan timed out; a narrower filter returned an empty page with a continuation token and was NOT interpreted as no incidents. Switched to authorized `GetLogEvents` on the actual running stream and checked the next page for the 19:00–19:20 window.
- Raw logs remain only under ignored/private `.env.kamal/production/diagnostics/line-chat-20260917/`; no customer text or raw LINE ID is copied into these documents.

Verification / remaining acceptance:
- Both new Markdown files' relative links resolve; API package name matches the planned runner; `git diff --check` passed.
- Runtime code and tests were not changed. No automated implementation test, synthetic LINE send, production DB/Redis access, provider setting change, restart or deployment performed.
- The spec's acceptance checklist is intentionally unchecked. Implementation, focused tests, real Redis reproduction, UAT real-LINE delivery and signed release acceptance remain future work.

## Korean-time correlation — owner follow-up 2026-09-17

Owner clarified that the screenshot time is Korean time and requested18:00–21:00, then extended the end to22:00. Interpret the incident day as2026-09-17, as stated in the assistant's progress message. KST UTC+9 means requested UTC09:00–13:00 / Bangkok16:00–20:00. At collection time22:00KST was still in the future; completed readback covers18:00–21:30:29.202KST only. No future monitoring/scheduled run was created.

Collection and reconciliation:
- Actual Production task API stream read in8bounded intervals, every page followed until empty/stable end:28,385raw events,16accepted LINE events,16terminal outcomes,0accepted events without terminal in the captured range.
- Terminal statuses:4completed,3staff_menu_talk,3staff_menu_promotion,1company_context_listed,1staff_menu_contact,2support_follow_up,2ai_budget_exceeded. `failed_terminal` alone is not proof of infrastructure failure: the generic classifier also labels the last two business outcomes that way.
- Raw pages, sanitized summaries and pagination coverage remain private under `.env.kamal/production/diagnostics/line-chat-20260917/kst1800-2200/`.

Matching incident sequence (all times KST):
-20:28:26.937→27.130: `staff_menu_talk`, delivered; event`01M2QJ01CYZ6JNB0H362ZGMD5G`.
-20:28:42.035,50.562,51.982: promotion-card terminal outcomes delivered. This matches the image's20:28package card and explains why static buttons still respond.
-20:28:59.220: accepted text event`01M2QJ10XYHT1JH6XQG3ACSYZ3`;20:29:00.790: `ai_budget_exceeded`. Request`c3db1c26-c107-498d-8e4c-6177b9dfa178`.
-20:29:04.269: another menu greeting delivered; event`01M2QJ15QYEDTDJCRMQ965MADE`.
-20:29:09.962: accepted text event`01M2QJ1BEAJ5VMR675629G4GAJ`;20:29:11.222: `ai_budget_exceeded`. Request`ac99d083-4c36-4e7f-97f8-f0c163f001ac`.

Confirmed cause and user-visible handling:
- Four `ai.company_budget.exceeded` records at20:29:00.518/.549 and20:29:11.020/.032 belong to the same company, with `spendSatang=8062`, `budgetSatang=8000`, `override=true`. This is a company-specific monthly AI budget override ofTHB80 and metered cost ofTHB80.62. It is neither a receipt-count quota nor evidence of a customer billing charge.
- Exact deployed `assertCompanyAiBudget()` compares current monthly metered spend to that effective company budget before a provider action; `runBudgeted()` returns HTTP429 code`AI_MONTHLY_BUDGET_EXCEEDED`. Intake routing and gateway turn each encountered the gate. The generic `AI Gateway error` line is therefore not proof that the AI Gateway or Bedrock was down.
- The NOGROUP warning preceding the first text was nonfatal on this Production source. The budget rejection is the independently evidenced blocking cause.
- Static menu greeting/promotion commands run before model admission, so they remain available. Tapping a greeting cannot reset the monthly budget.
- The deployed branch calls `deliverRequiredMessages(buildAiBudgetExceededMessage(...))` before recording the budget terminal outcome; recorded delivery stages completed in156ms/177ms without delivery-pending failure. The expected returned card is “โควตา AI เดือนนี้ครบแล้ว”, with package actions. This establishes the application's successful delivery path, not visual proof that the screenshot author read the card.
- The successful21:10casual turn belongs to a DIFFERENT company from the two budget refusals. It does not establish recovery for the affected company's budget.
- The sequence closely matches the screenshot and clarified time; raw typed content and the screenshot person's account identity were not independently queried. No identity is inferred from a visible avatar/name.

Specification impact:
- Added the confirmed Production budget diagnosis and an acceptance check preserving budget admission after a missing-ledger fix. Do not bypass the cap or promise that the UAT fix alone restores this company's AI.
- Potential follow-up only: current terminal classification maps known budget/support outcomes to generic `failed_terminal`; classify/report those intentionally when that observability work is authorized. No classifier code changed here.
- Existing owner/admin policy governs any company budget adjustment. Do not change default budgets, company overrides, spend history or package settings from a diagnosis request.

## Combined specification — owner follow-up 2026-09-17

- Owner requested: “ทำ spec แก้ไขทั้งหมด รวมไปใน Nogroup เลย”. Expanded the existing spec/plan in place rather than creating another competing implementation spec.
- Owner explicitly selected separate chat/OCR caps, each confined to its own budget under the existing total. This supersedes the earlier undecided/reserved-OCR alternative; no additional split-policy approval is needed to prepare/implement this design when implementation is requested.
- Five scopes: A ledger lifecycle; B typed budget errors, honest receipt persistence/manual fallback and terminal metrics; C measured intake optimization; D admin usage visibility; E split caps/config/admission.
- CHAT covers chat/general AI including CRM/draft; OCR covers governed document-reading calls, including LINE image intake and statements. Classification is server-derived before provider execution; one mixed image-intake call cannot be assigned a fictional partial cost.
- The design uses durable upper-bound reservation/atomic settlement for SPLIT because live aggregate checks alone permit overshoot, and the current code also has separate chat/media admission leases. This is a design to meet separate hard ceilings, not evidence that reservations already exist.
- Preserve SHARED by default, require explicit admin caps, and activate SPLIT next Bangkok month for a company with existing spend so unknown legacy intake costs are not guessed/reallocated. No live amounts or rollout dates were chosen.
- Reporting retains unknown historical classification and unavailable historical cost components. No usage history is repriced, rewritten or backfilled by guessing.
- Added architecture, contracts, migrations, permissions/CAS/audit, all-seam coverage, finite execution bounds, reservation uncertainty handling, UX states, acceptance and rollback. Cross-linked the original metering and OCR specs to avoid contradictory source-of-truth guidance.
- Reviewed local current code/contracts for admission lanes, metering schema, admin API/CAS/history, terminal classification and frontend states. No new cloud access or application edits were performed for this documentation follow-up.
- Documentation verification passed: scoped `git diff --check` plus Python validation of 6 documents, 25 local links, 41 unique unchecked acceptance criteria, 14 spec sections, balanced code fences and 10 existing planned test paths. Runtime tests/cost benchmarks are not run because implementation has not begun. All new implementation acceptance remains unchecked.

Next: execute the unified plan only on an implementation request. The owner has chosen split caps; remaining company-specific amounts are runtime admin settings, not a reason to ask the same policy question again.

## Impact review round 2 — 2026-09-17

- Owner requested another review for impact, bugs and surrounding gaps. Reviewed local source `61c7cc37ea8f42ddb2c240fbed52a493976df3df`; no fresh Production observations or provider/cloud actions in this round.
- [Review artifact](../research/line-ai-remediation-impact-review-2026-09-17-th.md) records 12 actionable findings: 8 P1 and 4 P2. All addressed at specification/plan level; none claimed fixed in application code.
- Key design correction: use per-provider-step reservations for SPLIT, not blanket whole-chain maxima. Four 200k timeout input bounds can already require THB79.20 at the illustrative FX33 before output/cache. Actual viable per-step bounds still require implementation proof.
- Added stable attempt/invocation/owner identities, authenticated settlement after lost/error responses, SDK attempt and rounding bounds, original-month policy/evidence, cost-adjustment event kind and usage basis. No shadow financial ledger or gateway DB access.
- Explicitly preserved onboarding Issue 4's usable-result OCR quota refunds separately from actual AI spending and uncertain money holds. Added original amendment link/precedence to avoid implementing obsolete retained-failure rules.
- Extended config protection to platform defaults, signup retries, HTTP DTO/controller mapping, active/pending month-boundary CAS, mode-switch restrictions and canonical lock ordering. Added support/billing readiness projections without changing billing permissions or granting AI money.
- Added permanent budget refusal handling for ledger drain, statement, CRM and draft; adjacent Redis >50 pending/multi-user and bad-key batch boundaries; persisted budget reason/scope for delivery recovery.
- Frozen benchmark denominators now include attempted/completed/refused/failed work; no apparent savings from dropping failures or suppressing calls through insufficient reservations.
- Scope remains documentation review/corrections. Runtime code/tests, benchmark runs, migrations and UAT acceptance are still pending. Next implementation must satisfy R-01–12 as well as prior AC/B/C/D/E/X gates; do not claim hard-cap readiness from written requirements.
- Review verification passed: scoped `git diff --check`; document validator checked 7 documents, 54 local links, 53 unique unchecked acceptance criteria and 13 existing planned test paths. The review's F-01–12 findings map explicitly to R acceptance cases. Validated the illustrative 4-call input-ceiling arithmetic locally; this is not a provider benchmark or runtime test.

## Phase A implementation — 2026-09-17

Branch `codex/line-ai-remediation-a-ledger-20260917` in worktree `/private/tmp/mangmee-line-ai-remediation-20260917`, cut from `origin/develop acfb6b8c`. Code only, no schema, no migration, no `package.json`, no workflow, no cloud/LINE access.

### Decisions

- `openWaitingUser` keeps calling `XPENDING` first. Only that call's `NOGROUP` is eligible for the absence exemption, matched on the error code / message prefix (`isNoGroupError`), never a substring of arbitrary text. `EXISTS` on the exact key is read only afterwards: `0` → confirmed absent → `[]`; `1` → `group_missing` → fail closed; anything else, or a failing `EXISTS` → `redis_unavailable` → fail closed. Errors from `XRANGE`, entry parsing and the durable marker lookup cannot reach the exemption.
- The read path never repairs state: no `XGROUP CREATE … 0` or `$`, no replay, no delete. A later `append()` still recreates stream and group exactly as before, so an expired key behaves like a new chat.
- Bounded pagination by stream id (exclusive `(<id>` start), `PENDING_SCAN_COUNT=50` per page and `PENDING_SCAN_MAX_PAGES=4` — 200 entries, the default `LINE_AI_LEDGER_MAXLEN`. The existing `limit` (3) is still the early stop. A budget exhausted while entries may remain throws `scan_incomplete` rather than returning an empty list that would invite a new capture. A non-array reply or a row that is not `[string, …]` is `malformed_response`, not an empty PEL. A row trimmed between `XPENDING` and `XRANGE` is skipped, never reconstructed.
- `claimOpenEntries` is now isolated per key: `NOGROUP` + `EXISTS=0` is skipped quietly (expired between `SCAN` and claim), `NOGROUP` + `EXISTS=1` is logged `ai.line.ledger.claim_group_missing` and skipped without recreating the group, and any other error (or an unusable `EXISTS`) returns what was claimed so far so a real outage cannot grind through 200 keys at one command timeout each.
- `ConsumptionMarkerUnavailableError` gained an optional `reason` (default `marker_unavailable`, so existing constructor calls and `instanceof` checks are unchanged). The dispatcher's `line_ai_marker_unavailable` warn carries it. Terminal status `marker_unavailable`, error code `CONSUMPTION_MARKER_UNAVAILABLE` and the customer reply are unchanged.
- Privacy (§6): the raw Redis `NOGROUP` message embeds company id and LINE user/group id, so no new or changed log line prints the key or the provider message. Lifecycle logs carry `reason` plus `chatKeyHash = hashMessagePreview(chatKey)`; other Redis errors reuse the existing `safeLineErrorDetails` sanitizer (error class/code only). Confirmed absence logs at `log`, never `warn`.

### Files

- `apps/api/src/modules/line-ai/application/line-ai-ledger.service.ts` — `exists` on `LedgerRedis`, `isNoGroupError`, `pendingPage`, `streamStateAfterNoGroup`, paginated `openWaitingUser`, per-key isolated `claimOpenEntries`, sanitized logs.
- `apps/api/src/modules/line-ai/application/line-ai-consumption-marker.ts` — optional `reason` on `ConsumptionMarkerUnavailableError`.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — `reason` added to the existing `line_ai_marker_unavailable` warn (one line).
- `apps/api/src/modules/line-ai/application/line-ai-ledger.service.spec.ts` — `FakeRedis` made faithful (NOGROUP from `xpending`/`xreadgroup`/`xautoclaim`, `exists`, `XPENDING` start-id incl. exclusive form and COUNT, numeric stream-id ordering, hooks for expiry / destroyed group / failing EXISTS / WRONGTYPE / malformed reply / creation between XPENDING and EXISTS), log capture, 13 new tests and an env-gated real-Redis block.
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `openWaitingUser` override on `makeLedgerUseCase` and two dispatcher tests.

### Verification

```
cd /private/tmp/mangmee-line-ai-remediation-20260917/apps/api
pnpm exec tsx --test --test-reporter=spec src/modules/line-ai/application/line-ai-ledger.service.spec.ts src/modules/line-ai/application/line-ai-consumption-marker.spec.ts src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts
  → tests 88, pass 88, fail 0
pnpm exec tsx --test --test-reporter=dot src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts
  → 694 pass, 0 fail
LINE_AI_LEDGER_REDIS_TEST_URL='redis://127.0.0.1:6379/15' pnpm exec tsx --test --test-reporter=spec src/modules/line-ai/application/line-ai-ledger.service.spec.ts
  → tests 37, pass 37, fail 0 (real local Redis 7.4.10, db 15; unset → the block SKIPs, tests 32)
pnpm --filter @watchdog-bms/api typecheck   → rc=0
git diff --check                            → clean
```

The real-Redis block covers absent key → NOGROUP → `[]`, short-TTL expiry → `[]`, `XGROUP DESTROY` → `group_missing` with entries and group state untouched, group + empty PEL → `[]`, paging the real `XPENDING key group (<id> + 50` exclusive-start form (55 entries from another member then the asker's, found), `scan_incomplete` on a 201-entry PEL, a real `WRONGTYPE` from a plain string on a ledger key, and tenant/user/chat isolation. It runs on synthetic tagged keys, deletes only the exact keys it named, and never calls `claimOpenEntries` (its SCAN would reach other sessions' keys on a shared server). `DBSIZE` of db 15 was 0 before and after the run.

Red→green (AC-09): with the HEAD sources restored and the faithful fake in place the ledger spec was `tests 32, pass 20, fail 12`, the first-message case failing with

```
✖ AC-01/AC-09: a brand-new chat reads empty, and the read creates no stream or group
  Error [ConsumptionMarkerUnavailableError]: line_ai_consumption_marker_unavailable:
  NOGROUP No such key 'lineai:ledger:c1:Uab12cd34ef56ab78cd90ef12ab34cd56'
  or consumer group 'lineai-turn' in XPENDING with GROUP option
    at LineAiLedgerService.openWaitingUser (line-ai-ledger.service.ts:356:13)
```

which is the UAT incident reproduced in a unit test. After the fix the same file is 32/32 (33/33 with real Redis).

Evidence class per ticked acceptance criterion (spec §14 forbids ticking from unit tests alone, so the fake-only parts are named explicitly):

| AC | Evidence |
| --- | --- |
| AC-01 | Real Redis (absent key → NOGROUP → `[]`, nothing created) + dispatcher test for the routing half |
| AC-02 | Real Redis (short-TTL expiry) + fake (a later append recreates stream and group) |
| AC-03 | Real Redis (`XGROUP DESTROY`, `XLEN` and `XINFO GROUPS` unchanged) + fake |
| AC-04 | Real Redis (group + ack-emptied PEL) + fake |
| AC-05 | Real Redis (asker sees pendingMedia/source proof; other member, other chat, other company read `[]`) + fake |
| AC-06 | Fake: marker present while the entry is STILL in the PEL (asserted), so the lost-XACK premise is real; marker-lookup failure throws `marker_unavailable`; dispatcher test proves no gateway call and no mutation |
| AC-07 | **WRONGTYPE is real Redis** (a plain string on a ledger key). Connection error, failing `EXISTS` and a non-0/1 `EXISTS` reply are **fake-only**; a command timeout is not simulated separately — it takes the identical non-NOGROUP branch |
| AC-08 | **Fake-only** — key expiry and creation between XPENDING and EXISTS need injected timing that a real server cannot be made to reproduce deterministically; asserts exactly one XPENDING and one EXISTS, so there is no retry loop |
| AC-09 | The saved red→green output above (HEAD sources, faithful fake) |
| AC-13 | **Fake-only** — asserts the captured log payloads, which is the only place log level and fields are observable |
| R-11 | Pagination past the first page and `scan_incomplete` are **real Redis** (the exclusive `(<id>` start is our own invention, so it is proven against redis 7.4.10 locally; production is ElastiCache 7.1). Malformed XPENDING replies and the `claimOpenEntries` isolation cases are **fake-only** — a malformed reply cannot be produced by a correct server, and reclaim SCANs keys this process does not own |

### Remaining

- AC-10, AC-11, AC-12, AC-14, AC-15, AC-16 stay open: they need a UAT real-LINE journey with terminal/delivery evidence, and AC-15 needs the signed production release protocol. Nothing here was deployed or promoted.
- Phase A does not touch budget refusal, intake cost, dashboard or split caps (scopes B–E).

### Known residuals (not changed in this phase)

1. **Context limit is applied before the consumption-marker filter.** `openWaitingUser` stops paginating at `limit` (3) and only then filters durable consumption markers, so three consumed-but-unacked entries from the same asker inside the 15-minute window can hide a fourth genuinely open question until the drain expires them. Pre-existing behaviour, unchanged here. Impact is bounded because durable intake state (`LineIntakeStateRepository`), not this stream, authorises financial continuation — the stream is a bounded reference only.
2. **`append()` still recreates a vanished group at id 0.** It runs `XGROUP CREATE … 0 MKSTREAM` before every append, so the next append on an EXISTING stream whose group was destroyed (for example a media clarification arriving after the read already refused with `group_missing`) silently recreates the group at `0` and re-delivers up to 50 old entries into the PEL. The durable delivery/outcome stores are what stop duplicate sends. Spec §3 and §4.4 deliberately keep append/ack out of this phase, so the read path was fixed without touching it.
3. **`ai.line.ledger.ack_failed` and `ai.line.ledger.append_failed` still log the raw provider message** (`line-ai-ledger.service.ts:322` and `:523`), which would embed the raw key if a `NOGROUP` ever surfaced from `xreadgroup`/`xack`. Same privacy family as §6, but they are unchanged best-effort lines outside this phase's diff.
4. **A `null` XPENDING reply is now `malformed_response` (fail closed)** where the old code read it as an empty PEL. Deliberate — the reply shape is the absence proof — and a correct server never returns null for the extended `XPENDING key group - + count` form, but it is a behaviour change, not a pure bug fix.

## Phase B implementation — 2026-09-17

Branch `codex/line-ai-remediation-b-budget-20260917` (worktree). Scope: spec §9.1–§9.4 only; no Prisma/schema change, no dependency change, no cloud/LINE/provider access.

Decisions:

- One shared vocabulary in `packages/contracts/src/line-ai.ts`: `AiBudgetScope`, `AI_BUDGET_REFUSAL_CODES` (adds `AI_BUDGET_INSUFFICIENT`), `isAiBudgetPermanentRefusal`, `isAiBudgetTransient`, `isAiBudgetRefusalCode`. Every seam keeps its existing envelope; only the code and the scope are shared.
- One mapper, `companyAiBudgetRefusal(decision)` in `company-ai-usage-meter.ts`, is the single place a decision becomes code + scope. All five money seams (LINE gateway `runBudgeted`, receipt OCR client, statement client, CRM client, draft use case) call it. `budgetScope` is `TOTAL` because the meter only reads the company total today; §12 fills in CHAT/OCR from that one function.
- Only a 429 `HttpException` whose body code is one we emit is trusted (`knownAiBudgetRefusal`). A provider 429, a non-429 carrying the same string, or a bare `Error` message keeps today's handling exactly.
- Short-circuit rule: exceeded / insufficient / unavailable stop the turn at the intake refusal (no second gate call, no OCR, no usage row, no second security event). `AI_BUDGET_BUSY` deliberately keeps its existing bounded busy-wait and its existing ledger follow-up — the lease frees between a media turn's model calls.
- Terminal classes: added `budget_refusal` AFTER `delivery_pending` and `failed_terminal`/`orphan_*`, so delivery truth still outranks semantics. An image turn that kept the picture and asked the numbered question keeps `clarification_required` (class `clarification`) and carries the budget `errorCode`; only a turn with nothing left to answer becomes `budget_refusal`. `support_follow_up` is now `intentional_noop`. Unknown statuses still fall to `failed_terminal`.
- Durable reason: `classifyLineAiGatewayFailure` now stores the real budget code instead of `LINE_AI_RATE_LIMITED`, and `emitLineAiTerminalOutcome` gained optional `budgetScope` + `mediaState` (`retained` / `save_failed` / `redelivered`). No money amount or company configuration is emitted.
- Controller review follow-up 1 (B-04): `ensurePendingMedia` answers a DIFFERENT picture with the already-open pending row BEFORE storing anything — its one-question-at-a-time design. That lane was rare until the money gate started routing every photo through it: five receipts would have produced one notice and four silences, with four pictures actually gone and telemetry reporting `redelivered`. The budget branch now compares `parked.pending.lineMessageId` with the event's: same id is a true redelivery and stays silent (`duplicate_media_pending`, `mediaState: 'redelivered'`); a different id, or no row at all, gets one deterministic reply that says this picture was not kept, repeats the same money reason and points at the open question or the web app (`clarification_required`, `mediaState: 'not_stored_open_question'`). `ensurePendingMedia` itself and the other clarify lanes are untouched.
- Controller review follow-up 2: the budget branch is reachable with `canCaptureExpense === false` — a signature-only caller passes the media entry gate, an admitted `BUSINESS_DOCUMENT_REFERENCE` route skips the capture denial, and the money gate then closes at the OCR hop. Parking a file and offering "1) record as receipt" there would hand them a workflow they may not finish, so persistence is now guarded: reply with the money reason alone, budget terminal status + errorCode, `mediaState: 'not_stored_no_permission'`.
- `formatBudgetMediaSaveFailedReply` became `formatBudgetMediaNotStoredReply(errorCode, kind)` — one money reason, three honest tails (`save_failed`, `open_question`, `no_permission`) — so the three "not kept" replies can never disagree about why the read stopped.
- Traced the "answer 1 while the budget is closed" continuation: `resolvePendingMediaAsReceipt` creates the draft from the stored attachment and replies from saved facts. It makes no provider or gate call at all, so the outcome is already honest and non-looping (a zero-amount NEEDS_REVIEW draft plus the web link). No change was needed there.

Files changed: `packages/contracts/src/{line-ai,expenses,banking,ai-draft-suggestion}.ts`; `apps/api` — `company-ai-usage-meter.ts`, `ai-gateway.client.ts`, `process-line-webhook.use-case.ts`, `drain-line-ledger.use-case.ts`, `line-ai-terminal-outcome.logic.ts`, `line-ai-formatter.logic.ts`, `line-business-card.logic.ts`, `receipt-ocr.client.ts`, `expense-extraction.use-case.ts`, `statement-ai-extract.client.ts`, `statement-import.use-case.ts`, `crm-ai-gateway.client.ts`, `crm-ai-assist.use-case.ts`, `crm-ai-auto-reply.use-case.ts`, `generate-suggestion.use-case.ts`, `customer-journey-signal.catalog.ts`; `apps/web` — `ExpensesPages.tsx`, `expense-upload.logic.ts`, `workspace-dictionary.ts`, `banking.logic.ts`, `InboxAiPanel.tsx`; infra — `runtime-alarms.sh`, `deploy.sh` (+ both spec scripts and the generated pin update in `validate-production-maintenance-release.sh` / `deploy-production.yml`).

Verification (all from the worktree, heavy typechecks serialised on the `/tmp/mangmee-heavy.lock` mkdir mutex):

- `pnpm --filter @watchdog-bms/contracts build` — ok. `pnpm --filter @watchdog-bms/api typecheck` — ok. `pnpm --filter @watchdog-bms/web exec tsc --noEmit` — ok. AI gateway untouched, so its typecheck was not run.
- API focused specs (`pnpm exec tsx --test --test-reporter=spec` from `apps/api`): 764 tests / 0 fail / 2 pre-existing skips across terminal-outcome, LINE gateway client, CRM gateway client, CRM assist, draft generation, usage meter, first-signup webhook, business card, LINE webhook, ledger drain, expense extraction, statement import and the two security-event specs.
- Contracts: `pnpm exec tsx --test src/line-ai-prepared-plan.spec.ts` — 41/0 (the budget truth table lives there because `packages/contracts/package.json` carries a fixed file list this change may not edit).
- Web: `pnpm exec tsx --test` on `expense-upload.logic.spec.ts`, `ExpensesPages.qa.spec.ts`, `workspace-i18n.spec.ts`, `banking.logic.spec.ts` — 85/0.
- `bash infra/monitoring/runtime-alarms.spec.sh` — ok. `bash infra/prod-ecs-express/production-serving-mode.spec.sh` — PASS. `node infra/security/sync-production-maintenance-release-pins.mjs --check` — current. `git diff --check` — clean.
- Merged `codex/line-ai-remediation-d1-usage-20260917` (which already carries Phase A) into this branch so CI tests the real combination. Six conflicts, all resolved by keeping both sides: five `company-ai-usage-meter` import lines (D1's `classifyAiUsageRequest`/`AiRequestContent` beside Phase B's `companyAiBudgetRefusal`) and the end of this memory doc (Phase A section first, then Phase B). Plan/spec ticks from A, B and D1 all survived the automatic merge. After the merge: `prisma generate` (D1 added columns), contracts rebuild, api + web typecheck, pins `--check` still current with no pin diff, `git diff --check` clean.
- Combined focused API set after the merge (adds Phase A `line-ai-ledger.service.spec.ts` / `line-ai-consumption-marker.spec.ts` and D1 `company-ai-usage-meter.spec.ts` / `get-partner-ai-usage.use-case.spec.ts`): 868 tests / 0 fail / 4 pre-existing skips. Web 111/0 (adds D1 `ai-budget.logic.spec.ts`), contracts 41/0.
- Red-on-old checks (temporary one-line reverts, restored and re-verified byte-identical): 6/8 new webhook tests, the OCR-hop test, and 4/7 new drain tests fail without the fix; the "behaviour unchanged" guards (busy fall-through, non-money OCR reasons, delivery-cap park) stay green by design.

Remaining:

- Spec §13 acceptance B-01…B-06 and R-09 are deliberately still unchecked: §14 forbids ticking acceptance on unit tests alone, and B-03/B-04/B-05 and X-02 need the real LINE and web journeys.
- Nothing emits `AI_BUDGET_INSUFFICIENT` or a `CHAT`/`OCR` scope yet — §12 (Phase E) does. This phase only recognises and carries them, and the CHAT card deliberately does not promise that receipts still work.
- The CRM inbox panel now says the money reason instead of "temporarily unavailable", but `crm-ai-auto-reply.use-case.ts` has no spec file in the fixed `apps/api` test list, so its budget-reason change is covered by typecheck only.
