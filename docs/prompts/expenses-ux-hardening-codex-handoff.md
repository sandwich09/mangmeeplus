# Codex Handoff: Expenses + Receipts UX Hardening

Role: You are the implementation engineer. Claude acts as harness engineer and will independently verify your result against the acceptance checklist — your job is the smallest correct diff that satisfies the plan, plus verification evidence.

## Source of truth

Read first, in order:
1. `docs/plans/expenses-ux-hardening-plan.md` — THE plan. Implement workstreams W1–W8 exactly as specified there (goals, files, acceptance criteria).
2. `AGENTS.md` + ponytail skill (`.agents/skills/ponytail/SKILL.md`) — working rules: shortest correct diff, existing patterns first, no new dependencies, one runnable check per non-trivial logic.
3. `docs/agent-memory/expense-detail-stepper-ux.md` — the working tree contains uncommitted stepper-UX work in `ExpensesPages.tsx` / `expenses.model.ts` / `workspace-dictionary.ts`. You MUST NOT revert or restructure it. Anchor edits on symbols, not line numbers.

## Hard constraints

- `apps/web` only. Zero diffs under `apps/api`, `apps/ai-gateway`, `packages/contracts` (except nothing), any `package.json`, or `pnpm-lock.yaml`.
- No new runtime or dev dependency. HEIC handling uses native browser decode (`createImageBitmap` / `Image`) with a graceful Thai error where unsupported — no `heic2any`.
- Use the shared `Modal` from `apps/web/src/common/components/modal` for the W3 and W5 popups (see its existing usage in `ExpensesPages.tsx`).
- New user-facing strings in `ExpensesPages.tsx` go through `workspace-dictionary.ts` (both `th` and `en` blocks). Strings local to `ExpensesWorkspacePanels.tsx` may stay Thai literals matching that file's current style.
- Do not remove/rename any existing handler, guard, tooltip, or action in `ExpenseDetailModal` beyond the W8 dictionary value change.
- New pure logic goes in `apps/web/src/common/forms/sanitize.ts` and `apps/web/src/features/expenses/expense-upload.logic.ts`, each with a colocated `*.spec.ts` in the repo's existing test style (see `apps/web/src/common/forms/trim.spec.ts`, `expense-review-steps.logic.spec.ts`).

## Suggested order

1. W4 sanitize helper + tests (everything else consumes it)
2. W6 upload logic module + tests, then wire `UploadPanel` (picker AND drop path)
3. W7 extraction retry (small, same function)
4. W2 manual panel restructure + `expenses.tab_manual*` keys
5. W3 category popup, W1 rename explicit-save (same file)
6. W5 signature popup (same file)
7. W8 dictionary rename + grep e2e/specs for "ปฏิเสธ" text assertions

## Definition of done — paste this evidence in your final report

- `corepack pnpm --filter @watchdog-bms/contracts build` output (exit code)
- `corepack pnpm --filter @watchdog-bms/web test` full summary (baseline was 325 pass / 0 fail; must be ≥ baseline + your new specs, 0 fail)
- `corepack pnpm --filter @watchdog-bms/web typecheck` (clean)
- `corepack pnpm --filter @watchdog-bms/web build` (success)
- `git status --porcelain` + `git diff --stat` (to prove scope: only apps/web + docs)
- Per-workstream one-liner: what changed, in which symbol, and which acceptance-checklist item it satisfies
- Any deviation from the plan: record it explicitly with reason (deviations without a recorded reason will be rejected in harness review)

## Escalation

If anything in the plan contradicts what you find in the code (moved symbol, missing key, conflicting uncommitted work), do not guess: record the conflict in your report, pick the smallest safe interpretation, and flag it for harness review.
