# Agent Memory: agent-capability-enforcement

Status: Updated workflow enforcement.
Owner: Codex main thread.
Scope: Make WatchDog-BMS agents stronger when auto-spawn subagents are unavailable.
Role gate status:
- BA: Goal is stronger agent process and fewer missed business gates.
- SA: Scope is workflow docs, skill instructions, memory template, and local gate-check script only.
- DEV: Ponytail read; smallest diff adds checklist/template/script without dependencies.
- Integration: Docs and script path verified locally; no app runtime path affected.
Decisions:
- Main thread must emulate BA -> SA -> DEV -> Integration when subagents are unavailable.
- Each role must leave concrete gate evidence before implementation or handoff.
- Tiny doc-only/one-line work may use terse one-line role evidence.
- Blocked gates require memory update, one precise question, and stop.
Open questions:
- None.
Artifacts:
- `AGENTS.md`
- `.agents/skills/watchdog-delivery-chain/SKILL.md`
- `.claude/skills/watchdog-delivery-chain/SKILL.md`
- `docs/agent-memory/_template.md`
- `scripts/check-agent-gates.mjs`
- `package.json`
- `docs/prompts/implement-from-spec.md`
Verification:
- `git diff --check -- AGENTS.md .agents/skills/watchdog-delivery-chain/SKILL.md .claude/skills/watchdog-delivery-chain/SKILL.md docs/agent-memory/agent-capability-enforcement.md` passed.
- `git diff --check -- AGENTS.md package.json scripts/check-agent-gates.mjs docs/agent-memory/_template.md docs/agent-memory/agent-capability-enforcement.md docs/agent-memory/web-alignment-review.md docs/plans/web-core-workspace-plan.md docs/prompts/implement-from-spec.md .agents/skills/watchdog-delivery-chain/SKILL.md .claude/skills/watchdog-delivery-chain/SKILL.md` passed.
- `pnpm agent:gates -- docs/_templates/implementation-plan-template.md docs/plans/web-core-workspace-plan.md docs/agent-memory/_template.md docs/agent-memory/agent-capability-enforcement.md docs/agent-memory/web-alignment-review.md` passed.
Next:
- Use fallback gate evidence on future work when subagents are unavailable.
