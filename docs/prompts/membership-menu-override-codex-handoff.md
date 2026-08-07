# Codex Handoff: Per-Person Menu Overrides (G15 — MembershipMenuOverride)

Role: You are the implementation engineer. Claude (harness engineer) independently verifies your result against the plan's acceptance checklist — deliver the smallest correct diff plus verification evidence.

## Source of truth (read in order)
1. `docs/plans/membership-menu-override-plan.md` — THE plan. Product rules 1–11 are non-negotiable; implement steps A–G.
2. Binding prior constraints: `docs/plans/employee-access-role-management-v2-plan.md:440-445` and `docs/specs/permission-matrix.md:109-115`.
3. `AGENTS.md` + ponytail skill — shortest correct diff, existing patterns, no new dependencies.
4. Pattern references (copy these shapes, do not invent new ones):
   - Write use case + transactional audit + DENIED audit: `apps/api/src/modules/employee-access/application/use-cases/update-employee.use-case.ts`
   - Guard helper shape + owner exemption: `domain/logic/employee-access.logic.ts` (`roleGrantViolation`)
   - Resolver: `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts` (+ its spec's `makeMembership` factory)
   - DTO style: `presentation/http/employee-access.dtos.ts`
   - Web mutation pattern: `IndividualPermissionsPrototypePage.tsx` `withBusy` + `reload()`

## Hard constraints
- NO new permission keys, NO permission-registry/sync/seed changes, NO new dependencies.
- Overrides apply BEFORE `filterPermissionsByEntitlement` in every resolution path, and never for OWNER/SYSTEM_ADMIN memberships (write-guard AND runtime skip).
- ALLOW = the menu's `view` keys only. DENY = all the menu's action keys. Anything else is an escalation bug.
- Migration follows `docs/guidelines/backend-hexagonal-code-style.md:142-152` (no idempotent CREATE for new objects).
- New API spec files MUST be appended to the `apps/api/package.json` `test` script list — they do not auto-discover.
- Web logic testable only in `.ts` files (`menu-override.model.ts` + spec); do not put logic in the `.tsx` page.
- The working tree state at start = PR #41 branch `fix/permissions-system`. Do not touch the expense feature files beyond what the plan requires (none).
- If `get-membership-effective-access` resolves permissions independently of the session resolver, it must go through the same `applyMenuOverrides` — verify, don't assume.

## Suggested order
1. A schema + migration → prisma:validate + migration:review
2. B pure logic + spec (run it)
3. E contracts + build
4. C resolver + spec cases; effective-access path check
5. D endpoints/use case/DTO + spec; register specs in package.json
6. F web api client + model + spec + page wiring
7. G docs

## Definition of done — paste this evidence in your final report
- `corepack pnpm --filter @watchdog-bms/api prisma:validate` output; `migration:review` diff summary (new enum + table only)
- API test full summary: baseline count BEFORE your change and count AFTER (0 fail both), plus proof the new spec files appear in the run output
- `corepack pnpm --filter @watchdog-bms/contracts build`, web test (baseline 348 + your new spec, 0 fail), web typecheck, web build — all exit 0
- `git status --porcelain` + `git diff --stat`
- Per acceptance-checklist item: one-liner mapping change → item
- Deviations from the plan recorded with reason (unrecorded deviations are rejected)

## Escalation
On any conflict between the plan and the code you find (moved symbol, different membership include shape, effective-access path surprises), record it, take the smallest safe interpretation, flag for harness review. Never guess silently on permission semantics — those are rules 1–11.
