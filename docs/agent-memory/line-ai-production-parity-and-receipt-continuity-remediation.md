# Agent Memory: LINE AI production parity and receipt continuity remediation

Status: Local production-parity and owner daily-closing implementation complete; PR #110 integration is active.
Documentation baseline is `3a06829`; repository stories 1-11
are `f0ab272`, `62b88a4`, `a43134b`, `7ce43fd`, `ad4405a`, `37b34e5`, `7fb7e5b`, `d7f8f6e`,
`9985770`, `5333bc0` and `e0f7383`. Look-forward local execution added story 12 (tsx application-graph
boot, `dfa2801`), story 13 (printed VAT annotation, `9b9834c`), story 14 (critical-field stability,
`74c7d70`), story 15 (controlled source-hashed image replay, `618bdb7`), story 16 (real-provider
15-turn conversation, `2be6faa`) and story 17 (aggregate local acceptance gate, `e1d0f5a`). Owner
follow-up documentation `65a8597`, Thai glossary `840a195` and whole-chain test registration `f2af517`
are pushed on `fix-line-ai-prod`. No deployment, cloud or database mutation was performed.

Owner: Product owner / implementation owner on `fix-line-ai-prod`.

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
- Treat `ผปก`, `คชจ` and `ลค` as bounded semantic-routing glossary entries, never as permission or mutation authority.
- Add one permission-checked daily-closing snapshot rather than composing a financial answer from multiple generic tools.
- Separate expense date, upload date, due date, overdue and no-due-date buckets; group every amount by currency.
- Never claim a bill that never entered the system is missing without an expected-document source of truth.
- The owner accepts the LINE OA unverified banner only for protected-roster `Mangmee Plus Owner Pilot – 2026-08-16`; this is not a general-customer waiver.

Open questions:

- LINE OA verification policy for a named pilot versus all customers remains an owner operational decision.

Artifacts:

- `docs/specs/line-ai-production-parity-and-receipt-continuity-remediation-spec.md`
- `docs/plans/line-ai-production-parity-and-receipt-continuity-remediation-plan.md`
- `docs/product/line-ai-owner-daily-closing-feedback-th.md`
- `docs/specs/line-ai-owner-daily-closing-spec.md`
- `docs/plans/line-ai-owner-daily-closing-plan.md`
- `docs/specs/expense-receipt-upload-spec.md` approval-mode source-of-truth alignment
- `docs/plans/substitute-receipt-company-policy-plan.md` supersession note
- Active cross-cutting gate in `docs/plans/master-implementation-checklist.md`

Verification:

- Owner daily-closing documentation baseline `65a8597` was pushed to `origin/fix-line-ai-prod`.
- Thai business vocabulary is supplied as bounded stable context to both semantic routers while the
  original message remains byte-for-byte unchanged. The corpus covers `ลค.` customer and `ผปก.` +
  `คชจ.` expense routes without deterministic keyword-to-tool selection. Focused router/corpus tests
  pass 34/34, full LINE business-coverage tests pass 391/391, AI Gateway typecheck and diff check pass.
  Configured-provider shorthand rows remain intentionally coupled to the Story 2 daily-closing tool.
- The whole-chain coverage guard now recognizes the repository acceptance catalog as an owned runner,
  and the previously orphaned terminal-outcome suite is registered in its API behavior lane. Catalog
  tests pass 4/4 and the coverage/terminal suites pass 8/8; commit `f2af517` is pushed.
- Story 2 registers `expense.get_daily_closing` as one permission-checked API tool. Sixteen bounded
  aggregate/count/detail queries run in one repeatable-read snapshot and reuse current tenant, branch,
  own and related ABAC. The output keeps occurred/upload/due/overdue/no-due lenses separate, sums exact
  decimals per currency, exposes paid and outstanding portions of partial payments, excludes rejected/
  voided rows from active buckets, bounds detail to 1–10 and reports truncation plus the honest
  never-submitted limitation. Composite due/evidence indexes have a fail-fast lock policy for release
  rehearsal. Focused business/controller tests, schema validation and API/contracts typechecks pass.
- Story 3 now exposes that tool through the accounting/CFO catalog, semantic router and accounting
  specialist. Its deterministic LINE answer preserves scope, date, per-currency totals, paid versus
  outstanding, due-today versus overdue versus no-due, review/evidence/duplicate counts, bounded
  action rows and the never-submitted limitation. Daily closing deliberately skips the model rewrite
  because `due` must never mutate into approval/payment language. LINE business coverage passes
  397/397 including shorthand routing, THB+USD separation, full owner sections and read-only web link.
- Multi-entry ledger/notebook/phone images are now explicitly classified as `MULTI_DOCUMENT`, retained
  behind one three-way clarification and never collapsed into a single expense. Choosing “สรุปหลาย
  รายการ” creates no expense, returns an honest web/review handoff and changes the retained media to
  `RESOLVED_MULTI_ENTRY_REVIEW` only after successful LINE delivery. The focused API flow passes 87/87;
  Prisma schema validation passes and both intake/OCR prompts have regression assertions for the rule.
- Conversation continuity is now symmetric: substitute receipt and pending-media work both answer an
  intervening business question through the normal governed route, keep the pending source state open,
  and append a deterministic resume capsule after the answer. Pending-media clarification data is
  removed from the side-question model payload; two simultaneous workflows produce an explicit
  selection prompt. Existing source-owned partial-field behavior and the exact 15-turn/15-minute bound
  remain covered. Focused media dispatch passes 87/87 and substitute/context suites pass 82/82.
- The whole-chain catalog now has 22 rows: 19 repository scenarios and three source-hashed external
  images. New mandatory rows cover owner daily-closing shorthand, the photographed multi-entry ledger
  and pending-media side-question resume. The controlled-image harness can require `MULTI_DOCUMENT`,
  clarification and absence of a single grand total without storing image paths/facts in git. Catalog
  and harness contracts pass 8/8; the actual three-image provider replay remains a controlled run.
- The updated configured-Bedrock conversation completes all 15 turns with four permission-checked
  reads (daily close, customer, low stock and sales), nine zero-tool turns, one deterministic capability
  follow-up and one denied daily-close request. The denied request plans the correct tool but invokes no
  ERP source, returns `PERMISSION_DENIED` and leaks none of the fixture totals. There are zero non-read or
  final-mutation calls and zero user-facing unavailable turns. Daily close took 16,723 ms; the other reads
  took 10,730–13,323 ms. Internal timeout/throttle events recovered through existing grounded fallbacks,
  so hosted concurrency p95/p99 remains mandatory rather than being hidden by this successful sample.
- The conversation harness now distinguishes a correct permission refusal (expected tool in the plan,
  no invocation) from a normal read (expected tool must actually run), and emits bounded turn/expected/
  planned/invoked diagnostics on failure. It still emits no conversation text or business identifiers.
- The first three-image provider replay found one forward contract gap: the photographed ledger was
  correctly classified `MULTI_DOCUMENT` with clarification required, but its response still exposed one
  `grandTotalAmount`. The shared OCR boundary now returns no single-expense `fields` for every
  `MULTI_DOCUMENT` classification and never runs the single-total vision re-read for that content kind.
  This protects future consumers as well as the current API mutation gate. Controller tests pass 49/49.
- The unchanged-hash three-image replay then passes every assertion. Royal Pizza remains `2,890.00`,
  VAT `189.07`, sale date `2026-08-15`, `ABBREVIATED_TAX_INVOICE` and `PAID`; the handwritten cash bill
  remains `5,260.00`, `HANDWRITTEN_CASH_BILL`, `PAID` with date missing; the ledger remains
  `MULTI_DOCUMENT`, requires clarification and exposes zero draft field keys. No raw image/OCR text or
  customer identity was committed.
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
- Story 12 was found by starting the real local service before conversation replay. The configured
  `tsx watch` loader does not emit TypeScript constructor metadata, so Nest created the first typed
  provider with an undefined config and the gateway could not boot. All Nest-created gateway
  constructors now declare explicit injection tokens; manually constructed provider/agent helpers are
  unchanged. A new application-context test boots the complete auth/security/health/LINE/draft/CRM
  graph under tsx, and both that test and AI Gateway typecheck pass. A real local main process now maps
  all routes and reaches `Nest application successfully started`.
- Story 13 was found by sending the source-hashed Royal Pizza image through the real local Typhoon +
  configured Bedrock OCR path. The first replay returned the correct total/date/document kind but
  omitted the explicitly printed VAT `189.07`. The deterministic cross-check accepted a VAT label,
  optional rate and amount, but not the exact printed annotation shape `VAT 7% (รวม) 189.07`.
- The bounded VAT parser now accepts only the known included-VAT annotations `(รวม)`, `(INCL)`,
  `(INCLUDED)` or `(INC)` between a printed rate and adjacent decimal amount. It still rejects a rate
  alone and multiple tax components. Focused controller/cross-check tests pass 45/45 and AI Gateway
  typecheck passes. Replaying the unchanged source hash returns `vatAmount=189.07`, sale date
  `2026-08-15`, `ABBREVIATED_TAX_INVOICE` and `PAID`; the harness then correctly exposed its own
  display-format mismatch (`2,890.00` versus `2890.00`) before reaching the handwritten row.
- Story 14's repeated unchanged-hash replay exposed two forward nondeterminism gaps rather than a new
  expected-value exception. Royal Pizza alternated between sale date `2026-08-15` and later print date
  `2026-08-16`; its VAT also disappeared when Typhoon's first reading retained the VAT rate/mode but
  lost the amount. The cross-check now deterministically prioritizes exactly one transaction/sale-
  labeled date and leaves multiple such dates missing. A handwritten `7-6-69` remains explicitly
  missing because both D/M readings are possible under ADR-0011.
- The existing one-shot Bedrock image re-read now also covers a missing VAT amount only when the first
  result has a usable total and explicit VAT context. It merges only a second-reading VAT value whose
  cross-checked total equals the first in exact minor units; it never computes VAT, replaces unrelated
  first-pass fields or loops. Focused tests pass 48/48 and AI Gateway typecheck passes.
- The final unchanged-source replay passes both controlled rows end to end. Royal Pizza returns total
  `2,890.00`, VAT `189.07`, sale date `2026-08-15`, `ABBREVIATED_TAX_INVOICE`, `PAID`; the handwritten
  bill returns total `5,260.00`, `HANDWRITTEN_CASH_BILL`, `PAID`, and explicitly reports
  `expenseDate` missing alongside review fields. No raw image, OCR text or customer identity entered
  repository evidence.
- Story 15 adds the reusable controlled-image gate without putting either supplied customer image in
  git. It requires both known scenario ids, an exact SHA-256 for each external file, an explicit
  human-reviewed marker and field-level expectations before making any call. It compares money as
  exact minor units (so comma formatting cannot create a false failure), can assert that an ambiguous
  field remains explicitly missing, caps image size and request time, and reports only hashes, byte
  counts, bounded classifications, field keys and asserted values. Harness tests pass 3/3; the real
  unchanged-hash two-image run passes every assertion recorded in Story 14.
- Story 16 extracts the delivered capability-follow-up check/reply into API domain logic, so the API
  and controlled conversation use the same production function without importing a decorated Nest
  use case into the runner. The focused API dispatch suite passes 84/84 and API/AI Gateway typechecks
  pass after the extraction.
- The real-provider runner stays outside both application build graphs, uses the configured Bedrock
  provider and production Orchestrator, fixed read-only ERP results, current 15-turn/15-minute context
  and five-second human-like cadence. It fails on any non-read category (including suggestion,
  evidence capture or draft creation), fewer than three successful reads/zero-tool turns, empty reply,
  user-facing provider-unavailable route, context drift or final mutation. It writes no API/DB/LINE
  state and emits no conversation text or business/customer identifiers.
- Strict local replay completes 15/15 turns: four read turns (expense/inventory/sales/CRM), ten
  provider-routed zero-tool turns and one deterministic delivered-capability follow-up; zero
  user-facing unavailable turns and zero non-read/final-mutation tools. Measured turn durations were
  expense 19,778 ms, inventory 15,404 ms, sales 13,600 ms and CRM 9,603 ms. Bedrock still throttled
  some internal casual/loop/critic calls and the existing deterministic/grounded fallbacks preserved
  the turn. The expense sample has only 222 ms margin under the 20-second outer runtime timeout, so
  hosted UAT p95/p99/concurrency remains a hard blocker; this local sample does not justify raising
  the timeout or claiming Production capacity.
- Story 17 makes the controlled-image harness contract part of the repository aggregate instead of
  leaving the privacy-safe runner as an unguarded side command. The current aggregate passes catalog
  4/4, controlled-image harness 4/4, API behavior 274/274, AI Gateway 187/187, UAT candidate policy,
  Production serving-mode, Production promotion-resource and Production deploy/rollback workflow
  contracts. The three unchanged source-hashed image rows and the real-provider conversation remain
  separate controlled executions and passed; no raw media or conversation content was committed.
- Final self-review did not convert local success into a live-release claim. The read-only local
  conversation intentionally created no persisted replay window, and the reconciliation CLI therefore
  was not pointed at a database. Hosted AgentCore p95/p99/concurrency, exact immutable UAT read-back,
  signed READY/Production results, LINE OA policy and customer `OPEN` are still mandatory later gates.
- 2026-08-16 owner feedback follow-up records the operator's actual daily-close job, Thai shorthand,
  supplied handwritten/multi-entry evidence, current-code gaps and a no-guess daily-closing contract.
  Local implementation and source-hashed evidence are pushed; PR and hosted release evidence are pending.
- PR #110's first full CI run found one shared launch-surface gap rather than a runtime regression:
  thirteen expense/substitute-receipt API codes had no customer-safe Thai renderer. Their mappings are
  derived from the API eligibility and continuation guards, tell the user the next valid action, and are
  protected by focused expectations plus the source-derived launch-code coverage test. Focused error UX
  tests pass 37/37, the complete Web suite passes 944/944, and Web typecheck passes.
- PR #110 CI run `31958602747` then proved the Web gap closed and exposed a stale security-alarm
  contract test: it selected the first metric `--filter-pattern`, which is now the preceding
  `line.ai.accepted` metric, instead of the named `security-high-risk` filter. The Production deploy
  script still contains both `CRITICAL`/`HIGH` risk clauses and both explicit AI event clauses. The
  test now locates the intended filter by its stable name before validating its pattern; no alarm or
  deploy behavior changed. Focused security tests pass 13/13, the full API suite and API typecheck pass.

Next:

- Open the implementation PR to `develop`, obtain CI/review approval, then promote the accepted revision
  to `main` through the required separate reviewed PR.
- Before any UAT action, read both mandatory cloud/deployment
  runbooks, deploy exactly one complete immutable candidate, and record the exact UAT run id.
- Run the hosted full replay, expected-concurrency p50/p95/p99 and persisted-state reconciliation before
  READY. The 19,778 ms local expense turn leaves only 222 ms under the current outer timeout and is a
  measured blocker, not permission to raise the timeout.
- Production remains closed until exact paired artifact read-back, signed READY, bounded canary,
  terminal reconciliation and customer `OPEN` all pass. Do not unlock failures by partial deployment.
