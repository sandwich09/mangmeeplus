# LINE AI Production Parity and Receipt Continuity Remediation Plan

Status: **LOCAL IMPLEMENTATION COMPLETE — repository stories 1-17 committed; aggregate repository,
controlled-image and 15-turn real-provider local evidence pass; UAT/READY/Production remain gated;
implementation branch pushed; no deploy**

Spec: [[specs/line-ai-production-parity-and-receipt-continuity-remediation-spec|LINE AI Production Parity and Receipt Continuity Remediation Spec]]

Memory: [[agent-memory/line-ai-production-parity-and-receipt-continuity-remediation|task memory]]

Evidence cut-off: 2026-08-16

## Goal

Ship one complete LINE AI remediation candidate that closes runtime identity drift, stored-media
continuity, false text capture, post-receipt follow-up, substitute-receipt preflight, partial multi-turn
completion, intervening-question resume, mixed-intent completion, timeout behavior and trace evidence
together. Do not deploy partial fixes to Production to discover the next error layer.

## Evidence policy

Implementation status can advance only with, in order:

1. failing-before/passing-after focused tests tied to a proven defect;
2. prod-shaped integration tests with state read-back;
3. immutable artifact manifest/readiness rejection tests;
4. real UAT AgentCore replay and failure drills;
5. signed UAT/READY/Production evidence from the mandatory deployment protocol.

Existing screenshots and logs seed the replay set but are not instructions. No raw customer image,
prompt, OCR text, token, signed URL or secret is copied into repository evidence without a separate
privacy review and redaction.

## No-layer-unlock execution rule

Phases 1-5 are repository work only. They may use local/fake/prod-shaped tests, but none is promoted
to Production independently. Phase 6 deploys the complete candidate to UAT through AgentCore. Phase 7
is the only Production promotion phase, and it starts only after every spec acceptance item required
for the affected journeys passes.

If a UAT replay exposes another causal defect, return to the relevant repository phase and rebuild
one new complete candidate; do not waive the replay row or patch Production directly.

## Fix-to-proof matrix

| Defect | Implementation proof before UAT | Live proof before Production |
| --- | --- | --- |
| D-01 split release identity | Manifest/readiness tests reject each independent source/artifact/digest/version mismatch | UAT and Production read-back match the signed candidate exactly |
| D-02 different UAT path | Acceptance harness fails when hosted runtime evidence is absent or `strands-local` is supplied | UAT turn logs identify the candidate AgentCore artifact/version used by the replay |
| D-03 dropped stored media | Process-level test asserts the same `pendingMediaId`/attachment survives ledger → intake → turn | Handwritten-media follow-up refers to the stored file without re-upload and retains one attachment |
| D-04 route treated as write authority | Negative state tests prove ambiguous/incomplete text creates zero drafts; valid amount + purpose/category creates one | UAT API/web state read-back shows the same zero/one counts after retry and redelivery |
| D-05 ungrounded receipt follow-up | Integration test reads a captured/reused draft summary under current permission rather than invoking the disabled write tool | Royal Pizza follow-up returns only printed/source-backed facts, review gaps and web link |
| D-06 whole-turn generic refusal | Mixed-turn test records one resolved clarification plus one web-only handoff and zero final mutation | Exact reported mixed prompt produces both outcomes in LINE and one/no permitted draft as specified |
| D-07 timeout/unknown refusal | Forced failure tests record typed code, artifact identity, stage durations and zero mutation | UAT replay/concurrency records p50/p95/p99, zero unexplained timeout and reconciled terminal outcomes |
| D-08 no grounded multi-turn receipt workflow | State tests prove partial answers, side questions, resume, revision changes and consolidated blockers use one typed workflow/draft while context remains 15 turns/15 minutes | UAT completes a partial-answer → question → resume journey without duplicate/stale mutation and hands final issuance to web |
| D-09 context-cap contract drift | Contract/loader/gateway tests assert exactly 15 recent turns and fail against the current constant of 16 | UAT turn metadata and the 16+ turn replay prove only the newest 15 in-window turns are supplied |

Passing a later column does not waive an earlier one. For example, a fluent Royal Pizza answer does
not prove artifact parity, idempotency or no false draft; all cells for the affected journey must pass.

## Phase 0 — Preserve and normalize the incident baseline

### Work

- [ ] Record sanitized live read-back scripts/commands for ECS source/digests, runtime mode,
      AgentCore source/artifact/version and log-window outcome counts.
- [ ] Add a repository-owned mismatch fixture representing deployed ECS
      `3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1` against AgentCore
      `eaa9005a1857b3cd582ceda743977496ed955110`; the readiness verifier must reject it.
- [ ] Add failing regression tests for:
  - `pendingMedia` disappearing between `openWaitingUser` and intake/turn requests;
  - ambiguous media follow-up routing to capture;
  - text capture without detectable amount plus purpose/category;
  - AgentCore refusal without a typed reason/artifact identity;
  - one mixed clarification + web-only mutation turn collapsing to one generic refusal;
  - a substitute request exposing only the first missing prerequisite instead of all knowable blockers;
  - partial answers or an intervening question losing/switching the current expense workflow; and
  - free-text history, rather than typed current source state, marking a field complete; and
  - the shared context constant retaining 16 rather than the selected 15 turns.
- [ ] Inventory the existing 15-turn/15-minute context loader, clarification ledger, pending-media row,
      expense draft/revision fields and substitute-receipt validators. Choose the smallest repo-native
      typed continuation seam; do not add a generic workflow engine or enlarge raw history.
- [ ] Define privacy-safe replay assets. Keep the supplied raw files outside git; record hashes and
      human-reviewed supported fields, then approve any redacted/cropped derivative separately.
- [ ] Record current focused-test baseline: AI Gateway 84/84; API/LINE 143/143.

### Exit evidence

- Each confirmed defect has a test or verifier that fails for the deployed/current faulty shape.
- Unsupported ChatGPT-inferred purpose/category/tax claims are absent from expected fixtures.
- No application or cloud state has changed.

## Phase 1 — Bind ECS and AgentCore to one immutable candidate

### Work

- [x] Define one additive release manifest schema containing source commit, service image digests,
      AgentCore artifact digest/object version/source, contract version and producer run identity.
- [x] Extend CI to produce and retain the manifest alongside existing immutable images and AgentCore
      CodeZip; Production consumes the retained bytes without rebuilding.
- [x] Verify current AWS CLI and official AgentCore version/qualifier behavior before choosing the
      immutable binding mechanism.
- [x] Implement one reversible binding:
  - exact immutable runtime version/qualifier if the verified service supports it; or
  - isolated candidate runtime plus exact ARN swap if it does not.
- [x] Make UAT deploy/update the candidate AgentCore artifact and run the same hosted path intended
      for Production.
- [x] Remove the hard-coded approved source from promotion collection/readiness.
- [x] Make UAT Passport, READY and Production validation compare manifest source/artifact/digests to
      live ECS and AgentCore read-back.
- [x] Preserve the previous active ECS task definition plus its AgentCore ARN/qualifier in signed READY,
      and preserve the new retained manifest/binding for exact closed recovery.

### Likely files

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-uat.yml`
- `.github/workflows/production-readiness.yml`
- `.github/workflows/deploy-production-v2.yml`
- `infra/ai-gateway/agentcore-deploy.sh`
- `infra/security/collect-production-promotion-resources.sh`
- `infra/security/validate-production-release-ready-v2.sh`
- related shell specs and release artifact schemas

### Verification

- Shell tests accept an exact candidate and reject source, artifact digest, object version, image
  digest, contract version and runtime-version mismatches independently.
- Repo-wide search finds no permanently approved AgentCore source SHA.
- A simulated failed AgentCore update leaves the current ECS pair untouched.
- A simulated ECS failure after candidate readiness restores the previously proven pair.

### Exit evidence

- An exact candidate pair can be promoted and rolled back without mutable-default ambiguity.
- `strands-local` may still run locally but cannot satisfy signed Production UAT evidence.

Repository story 6 evidence: CI retains one canonical manifest plus exact CodeZip/contract; UAT deploys
that CodeZip to an environment-isolated runtime, creates a source-specific endpoint pinned to the
immutable runtime version, and carries the exact binding in Passport V2. Offline gates reject changed
bytes/source/image/contract/object key/runtime version, endpoint/runtime ARN mismatch, `DEFAULT`, and
tampered Passport binding. Installed AWS CLI `2.36.15` proves endpoint read-back fields are
`targetVersion`/`liveVersion`; the deploy check asserts both before UAT ECS receives the qualifier.
Repository story 7 evidence: Production readiness stages the retained CodeZip in a dedicated
Production candidate runtime/execution role, pins a source-specific endpoint and signs the exact
binding into READY. Promotion consumes that binding rather than mutable GitHub ARN/qualifier values.
The mutation-boundary baseline now preserves and rechecks the previous AI Gateway task definition and
its AgentCore ARN/qualifier, while post-rollout verification requires the active task to match the
signed candidate pair. An ECS canary rollback therefore restores the previous atomic task-definition
pair; controller recovery redeploys the new exact candidate globally closed. Offline tests reject
source/artifact/object-version/runtime/endpoint drift, prior-pair drift, active-task qualifier drift,
`DEFAULT` for a new candidate and IAM/read-back mismatch. No cloud operation was run.

Repository story 8 evidence: UAT and Production derive the expected hosted source, retained CodeZip
digest and runtime contract version from their validated signed binding and inject all three into the
AI Gateway task. The gateway fails closed when a successful AgentCore response omits or mismatches that
identity, while failures/timeouts preserve expected identity plus endpoint binding without inventing an
actual responder. The active-task verifier and signed Production baseline compare endpoint and expected
identity as one unit, including negative artifact/contract/source drift cases. Focused contract,
config, gateway, API, workflow and release-shell suites plus all four affected typechecks pass; no cloud
operation was run.

## Phase 2 — Close media continuity and mutation authority together

### Work

- [x] Preserve `pendingMedia` in the `openWaiting -> openClarifications` mapping and every downstream
      bounded contract.
- [x] Re-resolve pending row, attachment, expiry, company, user, membership, branch scope and current
      permissions before use.
- [x] Add a final API-owned capture eligibility function used by both immediate media and
      clarification/text continuations.
- [x] Authorize media capture only after the existing deterministic document-evidence gate or exact
      resolved pending-media choice.
- [x] Authorize text-only capture only when source-grounded amount and purpose/category are both
      detectable, matching the existing Expense and Receipt Upload Spec.
- [x] Keep ambiguous/expired/legacy-without-media entries at clarify/no-op; never fall back to draft.
- [x] Preserve idempotency by LINE message id and existing source record; one retry/redelivery remains
      one attachment/draft.
- [x] Ack clarification only after the resolved receipt/text-capture outcome is successfully delivered.

### Likely files

- `packages/contracts/src/line-ai.ts`
- `apps/api/src/modules/line-ai/application/line-ai-ledger.service.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`
- `apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts`
- existing business-document and value-candidate pure gates/specs

### Verification

- Process-level test asserts the exact `pendingMediaId`, attachment id and MIME type reach both intake
  and AI turn requests.
- Ambiguous urgency text after media creates zero draft rows and keeps one pending clarification.
- Incomplete text note creates zero drafts.
- `ค่าเดินทาง 200 บาท` with a detectable configured purpose/category creates exactly one
  `NEEDS_REVIEW` no-receipt draft.
- Choice 1 resolves the stored attachment once; choice 2 creates no expense draft.
- Redelivery, timeout and concurrent duplicate events remain one target record.
- Permission revoked/attachment deleted/clarification expired paths fail closed.

### Exit evidence

- The context fix cannot increase mutation reach because the mutation guard ships and passes in the
  same candidate.

## Phase 3 — Ground receipt continuation and substitute-receipt preflight

### Work

- [x] Add a bounded continuation reference after successful/reused receipt capture: source record id,
      safe verification summary reference and delivered outcome id; no object key/signed URL/raw OCR.
- [x] Resolve follow-up receipt questions through the current permission-checked expense detail or a
      deterministic API-owned capture summary, not the disabled evidence-write tool.
- [x] Format printed facts, uncertain/missing fields, company-policy questions and web review action
      separately.
- [x] Preserve per-subrequest outcomes so a clarification choice can complete while final issuance is
      refused/handed to web.
- [x] Consume only the resolved clarification ids whose outcomes were delivered.
- [x] Keep substitute-receipt/final document generation, confirmation, payment, VAT decision and
      posting web-only.
- [x] Set `LINE_AI_CONTEXT_MAX_TURNS` to 15 and keep the 15-minute general conversation window. Assert
      the same value in contract, API loader and gateway request metadata. Add a bounded typed
      continuation state that references the current company/user/expense/workflow,
      normalized accepted values and per-field provenance, resolved/missing field keys, attachment
      ids, pending question, target revision and last activity; do not copy raw prompt/OCR text or
      treat `AiTurn` history as accepted field state.
- [x] Add one API-owned, permission/branch-filtered substitute-readiness preflight that reuses existing
      eligibility and validation rules and returns every currently knowable actionable blocker in one
      response. Target selection is the only allowed earlier clarification when no unique expense can
      be resolved.
- [x] Reconcile preflight with the owner-approved approval modes: no policy row is default
      `OWNER_SELF` and not automatically disabled; `DESIGNATED_APPROVERS` requires an eligible configured
      approver. Return `configured` and `ready` as different facts and never invent a policy blocker.
- [x] Accept bounded normalized partial candidates for missing-receipt reason, business purpose, payee,
      payment date/method, item/amount and configured category. Stage certificate-form-only values as
      web-prefill state without creating `PREPARED` evidence; mutate expense-owned fields only through
      existing draft/correction permission, status, provenance and validation gates. Resolve
      “ฉันเป็นผู้จ่าย” only to the active linked member in current branch scope.
- [x] Reject text as a substitute for evidence files, signatures, approver policy, approval, issued PDF,
      confirmation/posting or an issuer-created external tax invoice.
- [x] Validate and idempotently apply each accepted field through the API-owned mutation boundary with
      provenance and current-revision protection. Preserve other accepted fields when one value is
      invalid or ambiguous; echo accepted fields and list all remaining blockers after each turn.
- [x] Classify an intervening question separately from pending field answers. Answer it through grounded
      read tools, then append a source-generated resume capsule without consuming unresolved fields.
- [x] Support one message containing both field values and a question as independent subrequests.
- [x] Support “ทำใบรับรองต่อ”, pause and cancel: resume only one uniquely permitted current workflow;
      require selection when several match; pause keeps accepted draft data; cancel closes only the
      targeted conversation state and never deletes expense/evidence records.
- [x] On context expiry or a web/concurrent edit, reload the current draft, access, policy, attachments
      and revision. Never claim unsaved text survived and never overwrite newer source state.
- [x] Pass only an opaque workflow/expense reference in the web handoff. After web authentication,
      reload and permission/revision-check server-side prefill values; do not place normalized business
      values, attachment ids or customer facts in the URL.
- [x] Bind typed prefill retention to the existing expense-draft/business retention boundary. Close or
      purge it on explicit cancel, successful authenticated web consumption or retention cleanup; never
      use conversation-history expiry to delete a valid draft and never resurrect expired pending media.
- [x] Normalize “ใบทดแทนใบเสร็จ” to `ใบรับรองแทนใบเสร็จรับเงิน`; distinguish ready, blocked,
      ineligible, target-ambiguous, forbidden and temporarily unavailable responses instead of generic
      feature-disabled copy.
- [x] Preserve immediately delivered capability context for a bounded follow-up such as “อย่างไหร่”.

### Likely files

- LINE AI request/response contracts and presentation types
- `process-line-webhook.use-case.ts`
- expense permission-checked detail/summary adapter already exposed to AI tools
- existing substitute-receipt eligibility/policy/readiness domain logic and a read-only LINE adapter
- existing expense draft/correction mutation boundary for safe partial fields
- substitute-receipt web wizard prefill loader using an opaque server-side workflow reference
- orchestrator/router/response composer and their focused specs
- formatter/Flex card specs

### Verification

- Royal Pizza replay returns only source-backed receipt facts and reviewable unknowns; it never
  invents meeting/purpose/category/tax eligibility.
- Follow-up works after both newly created and idempotently reused drafts.
- Mixed `ข้อ 1 ... และออกใบรับรอง...` records one capture/resolve outcome plus one web-only handoff,
  with no final document mutation.
- One substitute request with multiple missing prerequisites returns all permission-visible blockers in
  one response and performs zero preparation/issuance mutation.
- Two partial answers update one workflow/draft; accepted values remain, remaining blockers shrink and
  an invalid value does not clear a valid one.
- An intervening question and a same-message field-plus-question both complete independently and leave
  an accurate resume capsule.
- Text cannot satisfy a required file/signature/approval/tax-invoice blocker.
- A valid existing receipt routes to normal receipt review unless unavailable/materially incomplete is
  proven; it does not create substitute evidence merely because the user asked.
- Multiple open workflows require selection. Pause/cancel does not delete the expense or attachments.
- A web edit, permission/company/branch change or context expiry reloads current state and prevents a
  stale overwrite/disclosure.
- Web handoff URLs contain no accepted field values, attachment ids or customer facts; stale/forbidden
  workflow references fail closed after authentication.
- Context expiry leaves a valid draft/prefill resumable under business retention, while explicit cancel,
  web consumption and cleanup close it and expired pending media remains unavailable.
- Context tests still pass at exactly 15 turns/15 minutes; no 30-turn prompt expansion is introduced.
- Permission/company switch between capture and follow-up reveals no stale record.
- Casual/capability exact prompts remain zero-tool on the same AgentCore-compatible request path.

### Exit evidence

- The feature-disabled message is used only for a genuinely disabled feature, not as a substitute for
  a safe captured-record read or web-only boundary.

## Phase 4 — Make latency and failure evidence actionable

### Work

- [x] Extend the additive AgentCore result/turn contract with normalized refusal/error reason,
      artifact source/version and per-stage durations/model-call counts.
- [x] Preserve compatibility when an older artifact omits new fields; readiness still prevents that
      artifact from becoming the accepted candidate.
- [x] Link sanitized webhook event, buffered turn, intake request, AgentCore invocation, tool calls,
      capture/read outcome and LINE delivery.
- [x] Measure and remove unnecessary sequential model calls for deterministic commands, capture
      summaries, capability help and already-grounded responses.
- [x] Bind each hosted invocation to the signed expected source/artifact/contract identity, reject
      missing or mismatched successful responses, and retain expected identity on timeout/failure.
- [ ] Run the complete replay matrix at expected UAT concurrency; record p50/p95/p99 per stage and
      total.
- [ ] Derive any invoke/tool/HTTP timeout change from those results and record the calculation.
- [x] Add terminal metrics for delivered, clarification, intentional no-op, permission refusal,
      feature-disabled, provider unavailable, timeout, delivery-pending and failed-terminal.
      Acceptance is emitted only for the first durable event create; batch members, retry/redelivery,
      delivery fallback and drain recovery use CAS-owned outcomes so one accepted event cannot be
      reported as both delivered and pending. CloudWatch filters are installed only on the API/web log
      group; the Phase 5 report still has to reconcile the persisted final snapshot end to end.

### Likely files

- `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/runtime.port.ts`
- `apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.ts`
- `apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts`
- API AI-turn/tool invocation persistence and observability specs
- CloudWatch metric/alarm/readiness evidence scripts

### Verification

- Forced timeout records `tool_unavailable`/`TIMEOUT`, exact artifact identity and zero mutation.
- Feature-disabled, permission-denied, unsupported and temporary unavailable are distinguishable.
- Webhook HTTP 200 cannot increment successful-AI outcome by itself.
- Redaction tests reject prompts, OCR text, image bytes, object keys, signed URLs and raw LINE ids.
- The fixed replay set has no unexplained timeout; measured p95/p99 and the selected timeout are stored
  in signed UAT evidence.

### Exit evidence

- An operator can identify whether a failure belongs to intake, artifact drift, AgentCore, provider,
  tool, source state or LINE delivery without Production DB access.

## Phase 5 — Build the whole-chain acceptance harness

### Work

- [x] Encode every mandatory replay row from the spec with outcome, tool, mutation and delivery
      assertions rather than exact stylistic wording.
- [x] Add privacy-approved redacted/cropped image fixtures only after human field annotation; otherwise
      keep live-image rows in the controlled UAT script with source hashes.
- [x] Add negative/property cases: ambiguous text never writes; unknown enum/old ledger entry degrades;
      retry/redelivery/concurrency never duplicates; permission revocation never leaks; a side question
      never consumes a form slot; text never satisfies evidence/signature/approval; consolidated
      preflight never falls back to sequential server-error discovery.
- [x] Add state-machine/replay cases for partial answers, invalid-plus-valid values, same-message question,
      intervening question, explicit resume, multiple open workflows, pause/cancel, 15-minute context
      expiry and concurrent web revision.
- [x] Add paired AgentCore/ECS rollback drill and mismatched-candidate rejection drill.
- [x] Add a reconciliation report: every accepted inbound reaches one terminal outcome class. The
      report reads a bounded persisted-state window, fails on in-flight/unknown rows, duplicate event
      ids, unexplained terminal failures or payload retained after a non-replayable terminal outcome,
      and emits only hashed event references.
- [x] Add a stale-doc/static check ensuring checklist/spec/readiness do not claim local-only proof as
      Production AgentCore proof.
- [x] Run a controlled local 15-turn conversation through the configured real provider with current
      15-turn/15-minute context, at least three successful read turns, at least three successful
      zero-tool turns, no user-facing unavailable turn and no non-read/final-mutation tool. Keep
      provider throttles and local duration observations visible; they do not satisfy hosted UAT
      latency/capacity evidence.

### Verification commands

Commands may be narrowed to changed files but must include at least:

```sh
corepack pnpm --dir apps/ai-gateway exec tsx --test \
  src/modules/line-ai/agents/intent-router.agent.spec.ts \
  src/modules/line-ai/agents/orchestrator.agent.spec.ts \
  src/modules/line-ai/agents/response-composer.agent.spec.ts \
  src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts

corepack pnpm --dir apps/api exec tsx --test \
  src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts \
  src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts

corepack pnpm --dir apps/ai-gateway typecheck
corepack pnpm --dir apps/api typecheck
git diff --check
```

Run the existing release/readiness shell specs plus new artifact-parity specs. Record exact command
and result; a green aggregate without the named regression assertions is insufficient.

### Exit evidence

- All known defect tests fail against the faulty fixture/shape and pass against the candidate.
- The complete candidate is ready for one UAT deployment; no partial Production deploy has occurred.

Repository story 17 evidence: the whole-chain aggregate now includes the controlled-image harness
contract and passes catalog 4/4, controlled-image harness 4/4, API behavior 274/274, AI Gateway
187/187, UAT candidate policy, Production serving-mode, Production promotion-resource and Production
deploy/rollback workflow contracts. The three external source-hashed, human-reviewed image rows passed
separately because raw customer media is intentionally outside git. The 15-turn real-provider run also
passed separately and remained read-only. These local results qualify the complete candidate for UAT;
they do not satisfy hosted latency, persisted post-replay state, signed READY or customer `OPEN` gates.

## Phase 6 — Deploy the complete candidate to prod-shaped UAT

Before any cloud action, read and follow:

- `docs/runbooks/cloud-environment-operations.md`; and
- `docs/runbooks/uat-production-v2-deployment.md`.

### Work

1. Dispatch exactly one UAT run for the complete candidate and record its run id/attempt/source.
2. Read back all three ECS service digests/source and exact AgentCore candidate artifact/version.
3. Prove the AI Gateway uses the hosted candidate path, not `strands-local` acceptance.
4. Run the full replay matrix through real LINE/UAT identities and permission scopes.
5. Verify state via permission-checked UAT API/web and sanitized audit/outcome evidence:
   - correct journeys create exactly one draft;
   - ambiguous/incomplete journeys create zero;
   - redelivery/retry remains one;
   - partial/resumed journeys keep one targeted workflow/draft and report all blockers together;
   - intervening questions do not consume fields or lose accepted values; and
   - preparation/signature/approval/issuance/final mutation from LINE remains zero.
6. Force AgentCore timeout/provider failure, delivery failure, permission revocation and paired rollback.
7. Run expected-concurrency latency measurement and record stage p50/p95/p99/model-call counts.
8. Observe until every accepted inbound is reconciled and no unexplained terminal outcome remains.

### Exit evidence

- Signed UAT artifact binds source, service digests, AgentCore bytes/version, contracts, replay results,
  state counts, latency evidence and rollback result.
- Any failure returns the work to repository phases; no duplicate UAT run is dispatched merely to
  discover the next error.

## Phase 7 — READY and Production promotion

### Preconditions

- Every spec acceptance checkbox affecting the reported journeys passes.
- UAT signed evidence is from the complete AgentCore candidate path.
- Readiness rejects the known `3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1` /
  `eaa9005a1857b3cd582ceda743977496ed955110` split fixture.
- LINE OA verification status and any named-pilot exception are recorded truthfully.

### Work

1. Follow the mandatory UAT/READY/Production protocol and record exact run ids.
2. Promote exact retained artifacts; do not rebuild.
3. Read back the Production ECS/AgentCore pair before customer `OPEN`.
4. Run a bounded canary: casual, capability, one permission-checked read, one receipt capture/follow-up,
   one partial-answer/question/resume workflow, one consolidated-blocker substitute handoff, one
   ambiguous no-write, one timeout-safe path and redelivery idempotency.
5. Reconcile terminal outcomes and verify zero unexpected draft/final mutations.
6. Obtain customer `OPEN` acceptance; workflow success alone is not completion.

### Rollback trigger

Any source/artifact mismatch, false/duplicate draft, stale-context disclosure, final LINE mutation,
untyped failure, unreconciled accepted inbound or replay regression closes the customer gate and rolls
back the paired ECS/AgentCore manifest.

### Exit evidence

- Production and UAT evidence identify the same immutable candidate.
- Customer `OPEN` and all mandatory signed results pass.
- Runbook, checklist and memory record measured results and remaining external OA status without
  claiming unsupported completeness.

## Definition of done

- The spec's entire acceptance list is satisfied with recorded evidence.
- No known bug is merely hidden behind a longer timeout, generic refusal or different UAT runtime.
- No partial production unlock was used as a diagnostic step.
- All documentation and runtime evidence agree on source, artifact, outcome and remaining gaps.

## Release repair — AgentCore MMDSv2 first create

Evidence from UAT run `31983841413` and the current AWS API/CLI contract fixes the next work to one
bounded release repair; no unchanged UAT retry is allowed.

### Work

- [x] Split the AgentCore first-create path into create without metadata, wait `READY`, full update with
      `requireMMDSV2=true`, wait `READY`, and exact MMDSv2 readback before endpoint creation.
- [x] Keep the existing-runtime path on the same full update/readback contract.
- [x] Extend the shell contract test so it fails if metadata is passed to create, omitted from update,
      or endpoint/smoke can occur before the exact MMDSv2 readback.
- [x] Make the UAT failure cleanup distinguish pre-rollout from post-intent failures. When deployment
      evidence was never created, emit the parent operation/run/task ids and require exact `PRE_INTENT`
      recovery instead of invoking retirement with a missing `api-web.json`.
- [x] Verify shell syntax, focused AgentCore/UAT policy tests, Production release workflow contracts and
      the complete whole-chain aggregate affected by these shared release paths.
- [ ] Commit and promote through successful exact-head CI. The owner's standing approval may bypass only
      GitHub's last-pusher approval deadlock, with immediate branch-rule restoration and readback; it
      does not bypass CI, UAT, reconciliation, signed results, rollback, or customer `OPEN`.
- [ ] Wait for parent `8bbb4b6e-460c-4d82-afd1-4428299f40a4` from UAT run `31983841413` to become
      `UNKNOWN`, dispatch the existing exact `PRE_INTENT` recovery once, and require
      `RECONCILED_FAILED_CONFIRMED` before the next release.
- [ ] Run the UAT prerequisite exact readback again, then dispatch one UAT `all` retry. Continue to
      conditional READY/Production only from its signed accepted passport.

### Verification evidence required before retry

- Current `create-agent-runtime` input contains no metadata field and current `update-agent-runtime`
  contains `metadataConfiguration.requireMMDSV2`.
- First-create and existing-runtime fixtures prove the AWS command order and failure stops.
- Pre-rollout failure fixture proves no missing-evidence retirement call and an explicit recovery-needed
  diagnostic; post-intent retirement behavior remains unchanged.
- Live readback proves no candidate runtime was left by failed run `31983841413`, no ECS service rollout
  occurred, and the failed parent was exactly reconciled before retry.
