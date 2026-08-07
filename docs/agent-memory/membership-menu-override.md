# Agent Memory: membership-menu-override

Status: PLANNED — 2026-07-26. Handed off to Codex; Claude = harness engineer (independent verification).
Owner: Claude (harness) → Codex (implementation)
Scope: G15 real per-person menu overrides — apps/api (MembershipMenuOverride model + migration + GET/PUT endpoints + resolver layer) + contracts + apps/web (wire prototype toggles). No new permission keys.
Decisions:
- Semantics: ALLOW adds the menu's view keys ONLY (no escalation to create/edit/approve); DENY subtracts all the menu's action keys; INHERIT = delete row. Deny-wins; unique(membershipId, menuId).
- Overrides apply BEFORE filterPermissionsByEntitlement (plan gate binds even overrides, same as OWNER) and are skipped entirely for OWNER/SYSTEM_ADMIN memberships (write-guard + runtime).
- Permissions reused, not added: read=access.employee.read, write=access.role.manage (ADMIN+OWNER; MANAGER intentionally excluded). Zero registry/sync changes.
- Guards: protected-target (NON_ASSIGNABLE_ROLE_KEYS), self-mutation denial w/ DENIED audit, granter ceiling on ALLOW (view keys ⊆ requester perms, owner exempt via ctx.roles) — all mirroring update-employee.use-case.ts; audit in same $transaction, riskLevel HIGH, new audit-action keys access.employee.menu_override.set/.clear.
- Eligible menus: MENU_REGISTRY ∩ non-empty view keys ∩ MVP1_INDIVIDUAL_PERMISSION_MENU_IDS (7 menus). `sales` has no view keys → ineligible.
- JWT permissions claim staleness (AI-gateway fast path) accepted — refreshes on token refresh, same as role changes; API/web resolve per-request (no cache today).
- Known trap for verification: apps/api package.json test script enumerates spec files explicitly; get-membership-effective-access may resolve independently of the session resolver and must agree.
Open questions: none blocking. (Second half of G15 — expense.receipt.line_upload matrix exposure — deliberately out of scope, still open.)
Artifacts:
- docs/plans/membership-menu-override-plan.md (product rules 1–11 + steps A–G + acceptance checklist)
- docs/prompts/membership-menu-override-codex-handoff.md
- ../Doc/membership-menu-override-summary-th.md (Thai summary, outside repo)
Verification (planned protocol, harness re-runs independently):
- prisma:validate + migration:review (single enum+table) → API tests (baseline recorded pre-change, 0 fail, new specs in run output AND package.json) → contracts build → web test (baseline 348 + new spec) → typecheck → build
- Full-diff review vs rules 1–11; resolver diff: pre-entitlement placement + OWNER skip; scope guard
- Stack-up manual walk: ADMIN toggles each state, target's sidebar changes, OWNER row locked, DENIED audits for self/owner attempts; e2e SET-08 unaffected
Next: owner runs Codex with the handoff prompt; on return, execute verification protocol, update Status here, push to PR #41 after sign-off.
