# Agent Memory: LINE AI production parity and receipt continuity remediation

Status: Implementation in progress. Documentation baseline committed as `3a06829`; repository story 1
(stored-media continuity, final capture authority and 15-turn cap) is implemented and focused-tested.
No push, deployment, cloud or database mutation.

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

- Exact immutable AgentCore version/qualifier or isolated-candidate-runtime mechanism must be selected
  after checking the installed CLI and current official AWS behavior.
- The smallest repo-native persistence seam for typed receipt continuation must be chosen after
  inventorying the existing clarification ledger, pending-media row and expense draft/revision fields;
  a generic workflow engine and larger raw context are out of scope.
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

Next:

- Commit story 1, then implement the typed substitute-receipt continuation/preflight story.
- Production remains blocked by this active gate until the full repository replay and later controlled
  deployment phases pass; this task will not push or deploy.
