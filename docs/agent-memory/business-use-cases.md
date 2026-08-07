# Agent Memory: business-use-cases

Status: Business use-case catalogue created; Fixed Assets placeholder superseded by item 21 handoff docs on 2026-07-05.
Owner: Codex main thread.
Scope: Convert existing requirement, plan, and spec docs into a business-facing use-case catalogue without adding new implementation scope.

Role gate status:
- BA: Business goal, users, journey, rules/exceptions, acceptance, and open decisions captured in `docs/product/business-use-cases.md`.
- SA: Architecture fit preserved: web source-of-truth, LINE/AI read-only or draft/deep-link boundary, permissions/ABAC/audit/source refs retained; no contracts, data model, or state transitions changed.
- DEV: Ponytail read. Smallest correct diff: one product doc, one memory doc, and navigation links in `docs/Home.md` plus `docs/README.md`.
- Integration: Doc-only change; backend/frontend contract unchanged. UI journey and loading/error/permission states referenced from existing Web Core and LINE specs. No E2E/browser path needed because no app code changed.

Decisions:
- Use `docs/product/business-use-cases.md` as the catalogue because it is product/business-facing, not a feature spec or implementation plan.
- Keep document in English/ASCII to match current docs.
- Include all 24 roadmap items so BA/SA/DEV/Integration handoff can map use cases to the canonical checklist.

Accepted assumptions:
- User wanted a generated business use-case document from existing docs, not a new feature implementation.
- Fixed Assets was a backlog placeholder at catalogue creation time. Owner pulled item 21 forward on 2026-07-05, so the catalogue now links [[specs/fixed-assets-spec|Fixed Assets Spec]] and [[plans/fixed-assets-plan|Fixed Assets Plan]].

Open questions:
- Should bank reconciliation be MVP?
- Does sales need visit scheduling or map route?
- Does the business use deposits, partial payment, or partial delivery often?
- Which export format do the accountant or accounting office expect?
- Is external accountant an invited user role from MVP?
- Which LINE invite/linking flow should be first: admin invite link, phone/email match, or manual admin approval?

Artifacts:
- `docs/product/business-use-cases.md`
- `docs/specs/fixed-assets-spec.md`
- `docs/plans/fixed-assets-plan.md`
- `docs/Home.md`
- `docs/README.md`
- `docs/agent-memory/business-use-cases.md`

Verification:
- `pnpm agent:gates -- docs/agent-memory/business-use-cases.md docs/product/business-use-cases.md` failed because `docs/product/business-use-cases.md` is a product doc, not a plan/memory doc with `## Role Gates`; same run reported `docs/agent-memory/business-use-cases.md: memory gate evidence ok`.
- `pnpm agent:gates -- docs/agent-memory/business-use-cases.md` passed.
- `git diff --stat` showed only `docs/Home.md` and `docs/README.md` tracked link edits; new product and memory docs are untracked as expected before staging.

Next:
- Owner can choose one use case to expand into a feature spec or implementation plan, following `docs/plans/master-implementation-checklist.md`.
