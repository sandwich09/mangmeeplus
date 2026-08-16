# Agent Memory: LINE AI production parity and receipt continuity remediation

Status: Implementation in progress. Documentation baseline committed as `3a06829`; repository story 1
(stored-media continuity, final capture authority and 15-turn cap) is committed as `f0ab272`; repository
story 2 (typed substitute-receipt continuation, consolidated readiness, grounded VAT/document question
safeguards and authenticated opaque web prefill) is committed as `62b88a4`; repository story 3 (grounded
captured-receipt follow-up, mixed outcomes and delivery-gated continuation) is committed as `a43134b`;
repository story 4 (bounded delivered capability follow-up and closed prefill lifecycle) is committed as
`7ce43fd`; repository story 5 (hosted runtime evidence and real cancellation) is committed as
`ad4405a`; repository story 6 (retained CodeZip/contract and pinned UAT AgentCore endpoint) is committed
as `37b34e5`; repository story 7 (Production READY/promotion/rollback bound to that retained candidate)
is committed as `7fb7e5b`; repository story 8 (signed expected hosted-runtime identity and fail-closed
response verification) is committed as `d7f8f6e`; repository story 9 (reconciled accepted/terminal
outcome telemetry and recovery semantics) is committed as `9985770`. Repository story 10 adds the
persisted-state reconciliation report) is committed as `5333bc0`. Repository story 11 adds the
whole-chain repository acceptance harness; it is verified and pending commit. No push, deployment,
cloud or database mutation.

Owner: Product owner / pending implementation owner.

Scope: Production AgentCore/ECS source parity; prod-shaped UAT; stored-media clarification continuity;
deterministic expense capture eligibility; grounded receipt follow-up; substitute-receipt preflight;
partial text completion; intervening-question resume; mixed-intent outcome; timeout,
artifact/refusal/delivery observability; whole-chain UAT/Production gate.

Decisions:

- Treat Production screenshots as evidence only; their timestamps correlate to Production logs, not UAT.
- Do not deploy the current AgentCore artifact alone: the current API still has a `pendingMedia` mapping
  defect and an insufficient final capture guard.
- Bind AgentCore and ECS with one immutable candidate manifest and paired rollback.
- Text-only expense capture continues only under the existing amount + purpose/category rule.
- Do not enable model-selected receipt write or any final LINE mutation.
- Enforce the owner-selected/general-spec context at 15 turns/15 minutes; current contract code is 16
  and must be reconciled to 15 rather than expanded to 30.
- Free-text history is not authoritative receipt workflow state. Use bounded typed state/current draft,
  re-resolve access and revision on every turn, and reload source state after context expiry.
- Permit multi-turn text completion only for validated safe draft fields. Text cannot replace evidence,
  identity checks, signatures, approver policy, approval, issued artifacts, posting or tax documents.
- Stage certificate-form-only values as bounded normalized server-side web-prefill state; update
  expense-owned fields only through existing draft/correction guards. Handoff URLs carry opaque
  references, not business values or attachment ids.
- The 15-turn/15-minute limit applies to prompt history, not business-draft lifetime. Typed prefill
  follows expense-draft retention and cleanup; expired pending media is never resurrected.
- Preflight and return every currently knowable permission-visible blocker together; do not unlock one
  validation error per user turn.
- Respect current approval-mode semantics: an absent policy row is default `OWNER_SELF`, not a false
  “feature disabled” blocker; `configured` and runtime `ready` remain distinct.
- Treat an intervening or same-message question as an independent subrequest, then return a current
  resume capsule without consuming unresolved fields.
- Resume only a unique permitted workflow; multiple matches require selection. Pause/cancel never
  deletes the expense, source attachments or issued evidence.
- Do not select a new timeout until full-candidate UAT p95/p99 exists.
- Require the complete replay/failure/state matrix before Production; no layer-by-layer unlock.

Open questions:

- LINE OA verification policy for a named pilot versus all customers remains an owner operational decision.

Artifacts:

- `docs/specs/line-ai-production-parity-and-receipt-continuity-remediation-spec.md`
- `docs/plans/line-ai-production-parity-and-receipt-continuity-remediation-plan.md`
- `docs/specs/expense-receipt-upload-spec.md` approval-mode source-of-truth alignment
- `docs/plans/substitute-receipt-company-policy-plan.md` supersession note
- Active cross-cutting gate in `docs/plans/master-implementation-checklist.md`

Verification:

- Evidence review used live sanitized ECS/AgentCore/CloudWatch read-back, deployed source inspection and
  focused current-source tests: AI Gateway 84/84; API/LINE 143/143.
- `git diff --check` passed after the document patch.
- All internal wiki links introduced by the new spec/plan/memory resolve to existing repository docs.
- Evidence/stale-claim search confirmed the new gate names the known split SHA, runtime mismatch,
  dropped `pendingMedia`, measured timeouts and amount + purpose/category capture rule.
- Prettier check was not run because this workspace has no `prettier` executable; no dependency was
  added for a documentation-only task.
- 2026-08-16 owner refinements added to spec/plan: partial multi-turn text completion, consolidated
  preflight, intervening-question resume, strict web-only issuance and selected 15-turn context.
- Self-review found and recorded two source-of-truth drifts instead of hiding them: shared contract code
  currently uses 16 turns although the governing/owner decision is 15 (D-09), and an older receipt-policy
  paragraph still claimed no-policy fail-closed although the later owner-approved runtime default is
  `OWNER_SELF`; the authoritative receipt spec and supersession notes now match current policy semantics.
- Final documentation checks passed: tracked and untracked whitespace checks, unique J/R headings,
  sequential Phase 0-7 headings and internal wiki-link resolution. Application tests were not rerun
  because this refinement changed documentation only.
- Story 1 process proof preserves the exact pending-media id, attachment id and MIME type in both
  intake and turn requests. The final API mutation boundary now rejects text capture unless an amount
  is present in exact source/answered-clarification evidence and purpose/category is source-grounded;
  unavailable OCR plus a caption now clarifies instead of creating a model-authorized manual draft.
- Story 1 verification: 165/165 focused API tests passed; API and AI Gateway typechecks passed; `git
  diff --check` passed. The context test now asserts exactly 15 turns.
- Story 2 focused API tests: 102/102 pass across continuation, substitute preparation/repository and
  LINE dispatch suites. Web API focused tests: 15/15 pass. API and web typechecks pass after rebuilding
  the local contracts package; `git diff --check` passes.
- Story 2 self-review prevented two forward failures: web consumption now occurs atomically with
  PREPARED evidence so it cannot stale its own certificate, and hypothetical/intervening questions
  cannot be parsed as payment/reason answers. A web/concurrent revision mismatch fails closed even on
  explicit resume; pause/cancel remain metadata-only.
- Story 3 adds a bounded delivered receipt reference containing only opaque ids/hashes/revision and a
  verification-summary presence flag. A grounded Royal Pizza follow-up reads the current scoped expense
  without invoking the model and separates printed facts, current system state, unknown review fields,
  policy/tax caveats and web action. Multiple current targets require selection.
- Story 3 preserves independent outcomes for the exact reported mixed turn: the pending attachment is
  captured once, the substitute-receipt request is preflighted separately, only its unresolved question
  remains in the ledger, and LINE performs zero PREPARED/sign/approve/issue mutation. Arbitrary side
  questions use the normal read path with the substitute clarification removed from model input, then
  receive a deterministic resume capsule after successful delivery.
- Story 3 look-forward review fixed two latent failures before commit: `findByIdWithRelations` now applies
  caller branch scope to the main expense row, and receipt/illustration pending media is not resolved or
  acknowledged until LINE delivery succeeds. A later redelivery cannot touch the revision of an expense
  that already has active substitute evidence, avoiding self-invalidating PREPARED/certified documents.
- Story 3 focused verification after review: 95/95 selected continuation/dispatch/repository tests pass;
  the larger combined regression run passes 210/210 after the delivery-order hardening; API typecheck and
  `git diff --check` pass.
- Story 4 preserves the fixed capability answer only after its turn is `COMPLETED`, then handles an
  immediately bounded vague follow-up such as “อย่างไหร่” deterministically with examples and the web-only
  final-action boundary. The same text without the delivered capability marker remains on the normal route.
  Typed substitute prefill is lifecycle-bound to its expense row; cancel and atomic web preparation close
  it as `CANCELLED`/`CONSUMED`, and closed values are not resurrected by explicit resume.
- Story 5 adds an optional, bounded AgentCore evidence contract: artifact source/digest/service and
  contract version, hashed runtime binding plus qualifier, measured body/validation/orchestration/HTTP
  durations, model-call count, normalized refusal and error code. Older artifacts remain callable but
  omit identity, so release readiness can reject them without breaking an in-flight compatibility window.
- Story 5 persists only the bounded evidence object on `AiTurn`; prompts, OCR text, media bytes/object
  keys, signed URLs and raw LINE ids have no field in this schema. The runtime client now aborts the
  actual HTTP invocation at the existing 20-second timeout instead of allowing the losing `Promise.race`
  request to continue and overlap a retry.
- Story 5 focused verification: AgentCore runtime/client/turn suites pass 72/72; the full LINE webhook
  use-case spec passes; contracts, AI Gateway and API typechecks pass; Prisma Client generation and
  `git diff --check` pass. No timeout value was changed because hosted candidate p95/p99 evidence does
  not exist yet.
- Story 6 uses an environment-isolated AgentCore candidate runtime plus a source-specific custom
  endpoint pinned to the immutable runtime version. This follows the installed AWS CLI `2.36.15` and
  official versioning behavior: runtime updates create versions, custom endpoints target versions,
  while `DEFAULT` follows latest and is therefore forbidden for accepted candidates.
- Story 6 CI retains `production-image-manifest.json`, exact `agentcore.zip` and its artifact manifest,
  retained `line-ai-contract.ts`, and a canonical release manifest. UAT deploys those exact bytes,
  validates runtime `targetVersion` and `liveVersion`, configures only the UAT candidate resource
  family for task-role invocation, and puts the exact runtime/artifact/object-version/endpoint binding
  in signed Passport V2.
- Story 6 negative coverage rejects split source, rebuilt/tampered CodeZip, changed image or contract,
  source not embedded in the content-addressed object key, runtime/endpoint ARN mismatch, version
  mismatch, mutable `DEFAULT`, extra evidence fields, and a tampered binding inside Passport. Focused
  manifest/binding/Passport/UAT policy suites and all UAT shell specs pass; production bootstrap and
  object-version IAM regressions also pass.
- Story 6 self-review corrected the AWS endpoint response contract from the nonexistent
  `agentRuntimeVersion` field to exact `targetVersion` + `liveVersion`, bound the endpoint ARN under
  the runtime ARN, and stopped treating IAM/AgentCore read errors as absent resources. An
  `AccessDenied` can no longer fall through into create/update and reveal the next error layer.
- Story 7 uses a dedicated Production candidate runtime and execution role so staging cannot mutate the
  legacy live runtime or its trust. READY signs exact retained CodeZip/object version/source/contract,
  runtime version, endpoint target/live version and role identity; Production deploy derives its ARN and
  qualifier only from that signed binding. Mutable GitHub AgentCore identity variables are no longer an
  accepted promotion input.
- Story 7 forward review closed the paired-rollback gap: signed READY now records the previous active AI
  Gateway task definition plus its AgentCore runtime ARN/qualifier, rechecks that pair at the mutation
  boundary, and post-deploy verification rejects an active ECS revision bound to any other qualifier.
  ECS canary rollback restores the previous task definition atomically; bounded controller recovery uses
  the new exact retained pair in global maintenance mode. Static/negative suites cover split source,
  tampered artifact/object version, endpoint drift, prior-pair drift, active-task drift and IAM drift.
- Story 7 focused verification passes candidate binding, Passport, Production promotion resources,
  runtime readiness, READY schema/baseline, readiness/deploy workflow, security preflight/bootstrap and
  serving-mode suites; shell/YAML/JSON syntax and `git diff --check` pass. No AWS call or workflow ran.
- Story 8 injects expected AgentCore source, retained CodeZip digest and runtime contract version only
  from the validated UAT/Production binding. AI Gateway rejects a successful response that omits or
  mismatches that identity; timeout, credential, network and HTTP failures retain the signed expectation
  and endpoint binding without falsely claiming which artifact answered.
- Story 8 deployment gates reject missing/malformed expected identity, ECS/AgentCore source split and
  active-task endpoint/artifact/contract drift. Production READY baseline now signs and rechecks all
  expected identity fields together; it accepts an all-null previous baseline only for the first compatible
  rollout and rejects partial/mixed identity state.
- Story 8 focused verification passes config 115/115, AI Gateway 42/42, API 70/70, all four package
  typechecks, UAT candidate policy, Production READY schema/baseline, Production deploy workflow and
  serving-mode suites. Self-review also narrowed the media-clarification ack parameter to the fields it
  actually consumes, closing a build-only TypeScript failure that the runtime unit tests did not expose.
- Story 9 emits `line.ai.accepted` only when the first durable event row is created and emits one bounded
  outcome record only after its owning status CAS succeeds. Every batched bubble receives an explicit
  intentional-noop outcome; LINE redelivery/reclaim does not increment acceptance again. Successful
  fallback no longer emits a transient delivery-pending outcome before provider-unavailable, while a
  failed fallback remains replayable through the orphan worker.
- Story 9 separates monthly/rate admission, provider/network/HTTP unavailability and real timeout.
  Permission/feature cutoffs in the ledger are acknowledged only after a visible refusal reaches LINE;
  stale turns and delivery-cap poison entries finalize with typed failed-terminal status. Legal-acceptance
  delivery is claimed before terminalization, releases on failed delivery, and stale claims can be safely
  reclaimed without storing raw chat/media data.
- Story 9 look-forward review corrected media clarification, duplicate-pending-media, safety/privacy,
  untyped refusal and mutation-refusal outcome families instead of counting every visible reply as
  delivered. CloudWatch installs the accepted plus nine bounded outcome filters only on the API/web log
  group. Focused LINE outcome/buffer/drain/orphan/gateway tests pass 145/145; API/contracts typechecks,
  serving-mode deploy contract, maintenance pin/validator suites, full local production-image security
  omnibus and whitespace check pass. The full Phase 5 persisted-state reconciliation report remains
  deliberately separate and pending.
- Story 10 adds a read-only persisted-state reconciliation CLI bounded to a required time window,
  optional company scope, 1,000-row pages and a 100,000-row safety cap. It classifies each accepted
  durable event into the same nine terminal families as runtime telemetry and fails closed when an
  event is still in-flight/unknown, duplicated, lacks a reason for failed-terminal, or retains replay
  payload after a non-delivery-pending terminal outcome. Provider event ids are SHA-256 references in
  output, never raw values. Focused reconciliation tests pass 3/3 and API typecheck passes; the command
  was not pointed at a database because the final local persisted-state replay has not run yet.
- Story 11 encodes all 19 mandatory replay rows with semantic outcome/tool/mutation/delivery contracts
  and binds each row to behavioral evidence that the aggregate runner executes. Seventeen rows are
  repository-automated; the Royal Pizza and handwritten-bill rows remain explicitly controlled external
  image replays so raw customer paths/facts cannot enter git or become false green fixture claims.
- The aggregate runner passes catalog 4/4, API 266/266, AI Gateway 172/172, UAT candidate policy,
  Production serving-mode, Production promotion-resource and Production deploy/rollback workflow
  contracts. It exercises partial answers, consolidated blockers, side questions, revision/context
  reload, permission revocation, redelivery, timeout, exact source binding and paired recovery together.
- Whole-chain self-review found and corrected two stale-proof gaps rather than weakening runtime behavior:
  one response-composer fixture still advertised 16 turns, and the buffered-media clarification spec still
  expected generic `completed` even though a visible pending-media choice correctly terminalizes as
  `clarification_required`. The exact reported casual phrases are also asserted as zero-ERP-tool paths.

Next:

- Commit repository story 11, then add the source-hashed controlled-image/local-conversation runner and
  execute the prod-shaped local conversation replay.
- Production remains blocked by this active gate until the full repository replay and later controlled
  deployment phases pass; this task will not push or deploy.
