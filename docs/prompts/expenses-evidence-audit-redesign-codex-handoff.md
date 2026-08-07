# Codex Handoff: Evidence Tab (หลักฐานทางบัญชี) Audit Redesign

Role: You are the implementation engineer. Claude (harness engineer) will independently verify the result against the plan's acceptance checklist. Deliver the smallest correct diff plus verification evidence.

## Source of truth

1. `docs/plans/expenses-evidence-audit-redesign-plan.md` — implement Workstreams A + B exactly (flag table, layout, tone maps, copy).
2. `AGENTS.md` + ponytail skill — shortest correct diff, existing patterns, no new dependencies.
3. The working tree carries uncommitted work from two prior verified tasks (expense-detail-stepper-ux, expenses-ux-hardening) in `ExpensesPages.tsx`, `ExpensesWorkspacePanels.tsx`, `workspace-dictionary.ts`, `expenses.model.ts`. Do NOT revert or restructure any of it. Anchor edits on symbols.

## Hard constraints

- Touch ONLY: `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` (`EvidencePanel`, `FolderBtn`), new `apps/web/src/features/expenses/evidence-audit.logic.ts` + `evidence-audit.logic.spec.ts`, and docs. Zero diffs elsewhere (`apps/api`, contracts, package.json, lockfile, other panels/components).
- No new dependency. Use existing `MangmeeStatCard`, `MangmeeBadge`, `MangmeeCard`, tones from `mangmee-design.ts`, `formatThaiMonth`, `TAX_EVIDENCE_STATUS_LABELS`, `TAX_EVIDENCE_REASON_LABELS`.
- Status never by color alone: every state renders icon + Thai label (⚠ ต้องตรวจ / ✓ ครบถ้วน / ไม่มีไฟล์).
- `amber` tone is reserved for attention in this panel — retone the มูลค่ารวม tile to `indigo` as specified.
- Keep existing behaviors byte-equivalent where the plan doesn't change them: row click/keyboard → `onOpenExpense`, `exportPackage` payload (`columnSet: 'full'`), `downloadManifest`, filter query params, dateField reset-on-switch.
- Pure logic in `evidence-audit.logic.ts` only — the component maps results to JSX. Test in node:test style like `expense-review-steps.logic.spec.ts`.
- Thai literals are fine in this file (its established style); do not add dictionary keys.

## Suggested order

1. Workstream A: logic module + spec (run the spec first).
2. B4 table (status column, badges, emphasis rows) — biggest visible win.
3. B1 KPI row + clickable attention tile; B2 toolbar + export relocation.
4. B3 folder sidebar; B5 keep-frame loading; B6 copy.

## Definition of done — paste this evidence in your final report

- `corepack pnpm --filter @watchdog-bms/contracts build` (exit 0)
- `corepack pnpm --filter @watchdog-bms/web test` full summary (baseline 338 pass / 0 fail; must be ≥ 338 + new spec count, 0 fail)
- `corepack pnpm --filter @watchdog-bms/web typecheck` (clean)
- `corepack pnpm --filter @watchdog-bms/web build` (success)
- `git status --porcelain` + `git diff --stat` (prove scope)
- Per-checklist-item one-liner mapping change → acceptance item
- Any deviation from the plan recorded with reason (unrecorded deviations are rejected in harness review)

## Escalation

If the plan contradicts the code you find (moved symbol, missing helper, type mismatch on `SharedEvidenceRow`), record the conflict, choose the smallest safe interpretation, and flag it for harness review. Do not guess silently.
