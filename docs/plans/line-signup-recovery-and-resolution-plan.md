# Plan: LINE signup recovery and resolution

Status: Implementation complete; local verification complete; source-matched CI/Git delivery pending. Spec established before application edits.
Spec: [LINE signup recovery/resolution](../specs/line-signup-recovery-and-resolution-spec-th.md)
Memory: [task state](../agent-memory/line-signup-recovery-and-resolution.md)

## Scope and working tree

- Base origin/develop `d03c1761932d19abc019afaaf10a8f75674ff0b4`; origin/main `700a6414a0915ac800e42bd1b0d2c1e2fb9e1523` fetched before work.
- Branch `codex/line-signup-recovery-20260907`, isolated worktree `../mangmeeplus-line-signup-recovery-20260907`.
- Original checkout has unrelated user documentation; hash snapshot kept under original output/line-signup-recovery-20260907. No stash, cleanup or unrelated commits.
- No package.json changes, no new dependency, no cloud mutation or deployment. Existing feature flags/presets remain; bug fixes do not need another opt-in flag.
- Deployment handoff: the next authorized release must apply both additive migrations and ship matching API/web contracts; an already-open old LIFF form may need reopening after release. Follow the mandatory deployment runbook and prior feature-enable/parity decisions then. Git merge alone is not customer availability or live acceptance.

## Implementation ownership

1. `signup_backend` — GPT-5.6 Sol xhigh: intake resume/idempotency, email routing, explicit admin outcomes/trial guard, proof/current-state checking. Own external-signup API/domain/tests, signup contract sections and CompanySignupRequest migration/schema.
2. `signup_ui` — GPT-5.6 Sol xhigh: truthful LIFF state renderer, large actions/input/retry, signup admin review UI, associated tests/mobile browser journey. Align exact contracts with backend owner.
3. `support_resolution` — GPT-5.6 Sol xhigh: request-bound support reply for no-company, assignment/resolution/pagination, pause-expiry impact, API/UI/tests. Own support contract sections/LineSupportRequest schema and separate migration.
4. Coordinator — GPT-6 Astra: spec/plan, challenge assumptions and adjacent impact, inspect diff, build combined contracts/Prisma, real PG/browser integration, final source-matched CI, PRs/admin merge develop then main.

Workers share this worktree with disjoint file/section ownership and send proposed contracts before touching shared sections. Only coordinator commits/pushes/merges. Each worker records commands/results and known gaps; completed lane is not overall acceptance.

## Steps and evidence checklist

- [x] Read current docs/code/contracts and reproduce G01/G02 before implementation (audit artifact).
- [x] Fetch branches, isolate worktree, preserve original user files.
- [x] Write spec with product rules, proof/permission boundaries, customer and admin outcomes.
- [x] Agree exact new DTO/action/fields between workers; record below.
- [x] Implement scoped fixes and focused regression tests in each lane.
- [x] Integrate schema/contracts/API/UI; review all callers and state/retention/cap/permission effects.
- [x] Apply migrations on task-owned temporary PostgreSQL, regenerate Prisma and run required real-PG specs; preserve unrelated user containers.
- [x] Test backend-to-frontend journey including fault/replay, existing-shop target, trial authorization, and no-company support reply/failure.
- [x] Run relevant workspace tests/typecheck and existing browser acceptance on isolated local services; inspect mobile result.
- [x] Update support playbook (remove weak proof assumption and stale email/trial wording), research status and memory with evidence.
- [ ] Freeze commit, push feature branch; review diff and CI of that exact source, create/review develop PR and admin merge.
- [ ] Promote same tested source to main via PR; resolve/retest any intervening change, admin merge, verify final trees and exact CI/merge IDs.
- [x] Record mail provider and subscriber payment flow as next task, with boundaries and relevant existing modules. No implementation of those future tasks yet.

## Integration contract decisions

Implemented integration contract:

- LINE GET/POST return `{progress, eligibleCompanies}`; progress carries requestId/submissionId/version/state, own editable contact data, intent, resolution, requestedInformation when applicable, entryCompanyId only when current access permits, retry/edit capabilities. GET selects latest; exact submission replay must select the exact request even when newer requests exist.
- POST has stable client `submissionId` UUID and `intent: FIRST_SHOP | ADD_SHOP`. The server scopes identity to verified LINE/channel. New intent/key after completion requires explicit add-shop choice.
- Contact correction: PATCH `/public/line-signups/:requestId/contact-email` with verified idToken, current version and contactEmail. It updates the existing request under a fence, invalidates stale review/grants, and returns the same progress envelope. Other users cannot enumerate the request.
- LINE admin actions: CREATE_NEW_SHOP / RETURN_EXISTING / REQUEST_INFO / RETRY_INTAKE plus existing REJECT/SUSPEND; official-site APPROVE stays. LINE actions require current version. Return-existing target comes only from proven memberships and is stored separately from provisioned companyId.
- Review resolution NEW_SHOP / RETURN_EXISTING / REQUEST_INFO / PLAN_REVIEW; PLAN_REVIEW remains actionable PENDING_REVIEW with no new company/trial. Repeat trial and shared-contact exception need separate explicit acknowledgement/reason, persisted and audited. REQUEST_INFO public message is the one bounded resolution note asking for all missing information; other internal notes stay private.
- REQUEST_INFO notification uses existing LINE outbox; QUEUED means durable enqueue, not customer delivery. Repeated requests require distinct review-version keys and stale notifications must not send obsolete instructions.
- Integration review found that a question without a live support case stranded a no-company applicant's reply. REQUEST_INFO therefore atomically links/creates a support case with an owner; the current question is displayed from the signup relation, without inventing customer message history. Ordinary unlinked applicant replies append to that live case, preserving explicit public commands and all identity boundaries. Verify question → case → customer reply → staff reply/resolution; outbound-only send is insufficient evidence.
- Support uses existing OPEN/ANSWERED/CLOSED statuses; explicit `closedReason=resolved` + note/actor are distinct from answered and AI pause. Request-bound reply, assignment/release/explicit handoff, paging, last response/attempt evidence live on the existing case.
- LINE push retry uses the provider retry key within its original24h window. A lost browser response after successful send must replay the same logical operation; new deliberate replies use new operation IDs. Acceptance must dominate an overlapping failed attempt. Official references: [LINE retry guide](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/) and [Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/).

Coordinator review findings to verify before acceptance: obsolete entry targets; exact earlier-request replay; once-per-request creation and AUTO cap consumption (including a request created yesterday but approved today); versioned REQUEST_INFO notifications; reply timeout after success; stale previous reply operation;24h retry-window drift; first reply with explicit null previous operation; claim/release/result audit atomicity; assignee deactivation/deletion/absence; unresolved support retention; mobile scroll reset after collapsing the long form. Any difference between implemented behavior and spec is a finding to close before Git delivery.

## Validation and delivery evidence

Evidence is local under `output/line-signup-recovery-20260907/`; no live LINE delivery, AWS operation, or production rollout is implied.

| Check | Result / evidence |
|---|---|
| Dependency install, contracts/config build, Prisma generate | PASS; frozen lockfile, no package/lock change |
| Both additive migrations | PASS on isolated PostgreSQL; existing user containers untouched |
| Workspace typecheck | PASS all packages; `workspace-typecheck-final.log` |
| P1 security | PASS 27/27; `api-p1-final.log` |
| LIFF focused / signup web focused | PASS 61/61 and 104/104; `signup-ui-evidence.md` |
| Support API focused / web focused | PASS 146/146 and 54/54; `support-evidence.md` |
| Generic + first-signup webhook regression | PASS 310/310; old false-receipt acknowledgement assertion corrected |
| Support real PostgreSQL | PASS 18/18; no-company reply, 205-row paging, race/retention/resume boundaries |
| Signup real PostgreSQL / first receipt | PASS duplicate/recovery28/28, identity/concurrency14/14, firstreceipt1/1; focused API241/241; `signup-backend-evidence.md` |
| Actual Redis consume-once | PASS concurrent same-operation, response loss after commit, principal isolation; `redis-once.log` |
| Browser integration | PASS 9/9; served LIFF/CSP with mocked identity/public API; real admin REQUEST_INFO and support claim/resolve API/DB plus owner permission denial; `browser-ux-final.log` |
| Final support mobile rerun | PASS 2/2; long messages readable without hover, no overflow, actions at least44px; `browser-support-final.log` |
| Whole workspace tests | PASS `pnpm test` exit0 on frozen application source; `workspace-tests-clean.log`. Earlier obsolete webhook expectation was fixed and its focused310/310 check passed before this clean run |
| Maintenance release pins | PASS45 exact files; validator SHA `50c79dc7b1ebc390639bb82dd6475246b8b685aa1b0df34bf989b2b64f12ef24` |
| Original user documentation | 13 hashed files unchanged |
| Final CI / PRs / merge SHAs | Pending; do not treat local validation as Git delivery |

Accepted mobile screenshots are in `browser-ux-final/`, including `signup-completed-390.png`, `support-no-company-claimed-390.png`, and `support-no-company-resolved-390.png`. Earlier screenshots with reference IDs or pre-final support layout are superseded.

Coordinator review closed: exact old request replay; revoked entry targets; once-per-request quota after response loss; approval-day cap; own historical email; repeat-trial authority; versioned question outbox; REQUEST_INFO→assigned support→unlinked reply; reply result/audit transaction and lost-response replay; deleted assignee takeover; retention of unresolved cases; truthful acknowledgement; mobile layout and form scroll reset; no technical codes in customer copy. Detailed rules and support boundaries are in the spec and support playbook.

Backend final review also fixed contact correction resumption using the committed version, with regression coverage. All three lanes are frozen; the correction preceded the clean workspace test invocation.
