# WatchDog-BMS Working Instructions

## Source Of Truth

- Docs in `docs/` are source of truth for product, specs, plans, ADRs, research, and prompts.
- Do not implement major features without relevant spec and plan.
- Record task state in `docs/agent-memory/<task>.md` when work spans multiple turns, touches multiple modules, or changes docs and code together.

## Default Workflow

For feature work:

1. Discover current docs, code, contracts, config, tests, and related checklist state.
2. Plan the smallest correct change against existing architecture.
3. Execute the scoped change.
4. Verify with at least one focused check for non-trivial logic.
5. Update relevant docs, plans, checklist, and task memory when scope/status changes.
6. Stop when verification evidence and next state are clear.

Do not use legacy named role subagents or delivery-chain subagents for normal work. Do not emulate legacy role passes in the main thread.

## Implementation Rules

- Keep docs-first behavior for major features: spec and plan before implementation.
- Reuse existing repo patterns, helpers, contracts, and permissions before adding new shapes.
- Keep AI Gateway separate from ERP core. AI Gateway must call permission-checked APIs/tools, not direct database repositories.
- Keep security, tenant, permission, audit, source-state, and final-mutation boundaries explicit.
- For non-trivial flows, verify backend-to-frontend contracts, loading/error/permission states, and existing E2E/browser paths when available.
- Do not edit, commit, or push changes to any `package.json` unless the change is adding, removing, or updating a dependency. `package.json` edits (scripts, metadata, reordering) cause frequent merge conflicts — leave them out of unrelated diffs.

## Ponytail Rule

Before code edits, read and follow:

`/Users/spare058/WatchDog-BMS/.agents/skills/ponytail/SKILL.md`

Use ponytail full mode: shortest correct diff, existing patterns first, no speculative abstractions, no new dependency unless already required, one runnable check for non-trivial logic.

## Review Checklist

Before accepting feature implementation, PR, or handoff, check:

- [ ] Product goal, users, main journey, rules/exceptions, and acceptance criteria are clear in spec, plan, memory, or final handoff.
- [ ] Architecture fit, contracts, data model impact, permissions/ABAC, state transitions, and scope boundaries are clear.
- [ ] Smallest correct diff is used; touched files are scoped.
- [ ] Backend-to-frontend contract, UI journey, loading/error/permission states, and E2E/browser path are verified when available.
- [ ] `docs/agent-memory/<task>.md` is updated when work spans multiple turns/modules or changes docs and code together.
- [ ] Verification commands/results are recorded, or exact reason not run is recorded.

Use `pnpm agent:gates -- <files>` only for older implementation plans or memory docs that still contain legacy role-gate sections. New docs should use product, architecture, implementation, and integration evidence instead.

## Escalation

If blocked by unclear product outcome, policy, system behavior, contract, data ownership, permission rule, test expectation, or user journey, ask one precise question, record current state, and stop. Do not guess across ambiguous boundaries.

## Memory Template

```md
# Agent Memory: <task>

Status:
Owner:
Scope:
Decisions:
Open questions:
Artifacts:
Verification:
Next:
```
