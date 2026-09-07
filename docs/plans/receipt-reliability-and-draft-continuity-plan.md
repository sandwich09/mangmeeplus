# Receipt reliability and draft continuity implementation plan

Status: In progress. User authorized implementation, commit/push and admin PR merge to develop and main on 2026-09-07.

Spec: [receipt reliability and draft continuity](../specs/receipt-reliability-and-draft-continuity-spec.md).
Evidence baseline: [T01–T18 inventory](../research/line-receipt-reliability-ux-review-2026-09-07-th.md).

## Baseline and working boundary

- Pull develop using fast-forward; baseline `4b91953f`. Application code matches diagnosed `604ac785`.
- Work on `codex/receipt-reliability-remediation-20260907` in `../mangmeeplus-receipt-remediation-20260907`.
- Preserve local user changes and other worktrees. No package.json edit unless dependency change is necessary; none planned. No dependency addition planned.
- Spec and this plan precede application code. Reuse existing upload, outcome, worker, quota, expense update, metadata, validation, permissions and web form patterns.

## Coding allocation and ownership

All agents use the same dedicated checkout with disjoint file ownership. Only the coordinator commits, pushes, creates or merges PRs. Agents must announce a need to touch another lane's files before doing so.

| Lane / model | Bounded responsibility | Owned files | Evidence |
|---|---|---|---|
| Receipt delivery — GPT-6 Astra, xhigh | Durable capture identity, truthful saved result, outcome/recovery, push retries and safe diagnostics; inspect admission/dedup boundaries and implement narrow continuity fix | API line-ai use cases/adapter/domain and focused tests; relevant AI gateway intake/quota boundary only by coordination | T02–T08, plus affected retry/routing regressions |
| Draft integrity — GPT-6 Astra, xhigh | Preserve financial rows/charges/discounts, 40-item staging, resume revision refresh, explicit target lookup, partial source API/read projection/permissions, unified completeness and controls | API expenses domain/use cases/repository/presentation and contracts; exclude receipt-ocr-apply.service.ts and its OCR-only tests owned by coordinator | T11–T18; backend portions T10/T14–T17 |
| Web continuation — GPT-5.6 Sol, xhigh | Same-draft staged facts/rows, partial save, missing fields, visible ordinary-language actions, authorized web continuation, reload and validation states | Web expense feature and relevant i18n/tests only | T10/T14–T17; actual rendered journey where available |
| Coordinator | Zero-price shared apply fix, integration contract review, all-lane impact/bug/gap checks, permanent test coverage ledger, local/CI verification and PR delivery | OCR apply service/tests, docs/plan/memory and necessary integration corrections coordinated with owners | T01/T09 and cross-lane acceptance |

Draft integrity publishes the exact `sourceDraft` read/write contract and authority semantics to web continuation before that agent wires requests. Both coordinate modifications to contracts through the backend owner. Delivery asks backend owner/coordinator before changing expense repository. Backend must not edit process-line-webhook; provide required integration instructions to its owner.

## Execution checkpoints

1. [x] Update develop, create isolated branch/worktree, preserve pre-existing local files, read AGENTS/ponytail and relevant docs, record current defects.
2. [x] Write this spec/plan and copy sanitized investigation/acceptance evidence into branch.
3. [ ] Implement each lane with focused permanent regressions; publish sourceDraft contract early.
4. [ ] Integrate receipt → collection → partial web save → LINE resume without lossy row replacement or false completion. Inspect all final mutation paths and scope/permission boundaries.
5. [ ] Run meaningful focused suites; contracts/API/gateway/web typechecks; applicable build/DB/browser checks. Complete T01–T18 evidence ledger with exact commands/results and scope limits. Do not substitute tests of a helper for the stateful path that originally failed.
6. [ ] Review combined diff against UX, SA, BA and AI engineering requirements; inspect adjacent money/tax/duplicate/quota/stale and role flows. Resolve findings before accepting.
7. [ ] Commit scoped files, push branch, create reviewable PR into develop with evidence. Wait for relevant CI; fix failures on this branch. Use authorized admin merge when needed after reviewing the actual result.
8. [ ] Update local/remote develop, create develop → main PR with final scope and exact evidence, resolve conflicts without losing main-only release configuration, verify candidate/diff and checks, admin merge as authorized.
9. [ ] Record PR URLs, commits, merged develop/main SHAs, final tests and remaining live acceptance. Update task memory and plan. Do not claim deployed behavior from a merge.

## Verification record

To be filled with actual lane and integration outputs. Historical no-write reproductions remain pre-fix evidence in the review, not post-fix passes.

## Runtime boundary

UAT/production workflows are manual in this baseline. This request ends with reviewed merges to develop and main. No cloud release, customer gate write, runtime toggle, outbound LINE test to real users, or customer data/quota repair is dispatched by this plan. A later runtime release must follow the mandatory deployment protocol and existing live feature acceptance gates.
