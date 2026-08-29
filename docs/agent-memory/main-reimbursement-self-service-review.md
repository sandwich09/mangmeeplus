# Agent Memory: Main Reimbursement Self-Service Review

Status: Review complete on 2026-08-27. Main had only the standard internal-role baseline. Subsequently authorized universal company-role implementation delivered by `/root/reimbursement_self_service`: code `065e917c`, delivery tip `be7d58c644e31abd123501e0c06f3be0931076fd`, confirmed by parent fetch of develop. Agent reports 333 API + 184 web tests and both full typechecks passing. No live permission sync/deployment; actual UAT session/root cause remains unverified.

Owner: Current backlog review task for evidence and coordination; `/root/reimbursement_self_service` for implementation, verification, and develop integration.

Scope:

- User reports an ADMIN without the สร้างคำขอเบิก button and states that every role should be able to request reimbursement.
- Source baseline: `007dcba70376acb94aa5b55275840304cabd6f68`; remote main checked again and unchanged.
- Interpret the product request as company-member self-service, distinct from reading others' claims, approval, finance review, and payment. A platform-only SYSTEM_ADMIN is not automatically a member of every customer company.
- Initial investigation was read-only. User subsequently authorized an agent to branch from develop, implement, test, and push into develop. No live permission-data, feature-entitlement, customer-gate, or UAT/Production changes are authorized.

Decisions:

1. **Standard ADMIN grant is already fixed in main.** `ROLE_GRANTS.ADMIN` includes reimbursement.read_own/create/update_own_draft/submit/cancel_own. The registry regression covers OWNER, ADMIN, MANAGER, HR, SALES, INVENTORY, FINANCE, ACCOUNTANT, MARKETING, and STAFF. The baseline change was introduced by `137141c8 fix(rbac): grant employee self-service safely`, contained in audited main.
2. **The button depends on effective permission, not the role label.** The hub passes `permissions.includes('reimbursement.create')` into MyRequests; the create link is rendered only when that value is true. The new route and API repeat the same permission requirement. Merely rendering the link would not fix an API 403.
3. **Effective permission is read from persisted role grants and filtered by company feature entitlement.** If reimbursement is disabled, main retains history/approval/payment runoff but removes create/draft-edit/submit; ADMIN does not bypass this. This is one possible explanation, not a confirmed diagnosis of the screenshot's UAT account. The launch matrix's documented initial gate is OPEN, so do not claim the feature is globally disabled on main.
4. **Every-role self-service is not implemented.** Current auth spec explicitly excludes arbitrary company custom roles, AUDITOR_READONLY, COMPANY_VIEW, and SYSTEM_ADMIN from the automatic internal-employee baseline. Custom roles opt into pack.reimbursement.self. Several presets (manager, finance, accounting, marketing, cashier, etc.) do not include that pack; core.basics grants related-record read only. There is no universal custom-role create/submit backfill. This differs from the user's newly stated every-company-role requirement.
5. **Empty-state UX remains inconsistent.** When canCreate is false and no claims exist, MyRequests still says to press สร้างคำขอเบิก even though that button is absent. Main now also shows a generic account-cannot-create banner, but it does not distinguish a feature-off decision from missing role grants.
6. **Do not confuse source state with live state.** System grants are synchronized by the normal deployment startup permission sync, but the actual UAT account, stored grants, entitlement, and served revision were not inspected. The screenshot alone does not establish which of those differs.

Open questions:

- No clarification is required for the code-status report. Any later implementation should document the user's expanded self-service rule, retain company membership/tenant/branch/own-record checks, and keep approvals/payments separately authorized. Do not silently open a disabled customer feature as part of a role fix.

Artifacts:

- [Main ADMIN grants](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/auth/permission-registry.ts#L585).
- [Main employee-baseline regression](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/auth/permission-registry.spec.ts#L91).
- [Main hub permission check](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/web/src/features/reimbursements/ReimbursementsPages.tsx#L603): conditional create link at 870 and unconditional empty-state guidance at 913.
- [Main persisted/effective permission resolution](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts#L61).
- [Main feature-off self-service restriction](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts#L328).
- [Main role templates](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/employee-access/domain/registries/role-template.registry.ts#L12) and [company-role backfills](https://github.com/MangmeeDev/mangmeeplus/blob/007dcba70376acb94aa5b55275840304cabd6f68/apps/api/src/modules/employee-access/domain/registries/company-role-backfill.registry.ts).
- Main docs inspected: auth-authorization-rbac-spec section 8; reimbursement-approval-spec; reimbursement-journey-uplift-spec; feature-entitlement-launch-matrix; employee-role-cache-contract memory. Older reimbursement grant tables should not override the newer registry/baseline decision.

Verification:

- Delivery cleanup: the agent reported accidentally generating through a symlink into the root checkout's ignored Prisma client. Parent regenerated from the root's own unchanged schema with `./node_modules/.bin/prisma generate` in root `apps/api`; PASS (Prisma 7.8.0). Compared generated embedded schema to root source with whitespace/comments normalized: identical. No database operation. Root tracked status remained only the pre-existing `docs/plans/web-line-login-plan.md` modification; review memories remain separate untracked task notes.
- Used the existing exact-main snapshot `/tmp/mangmee-main-wht-vat.nbXuKs` with existing installed dependencies; no branch switch.
- `./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec apps/api/src/modules/auth/permission-registry.spec.ts apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts apps/api/src/modules/employee-access/domain/logic/role-template-system-role-parity.spec.ts apps/api/src/modules/access-control/permission-resolver.spec.ts` — PASS: 95 tests, 11 suites.
- Source inspection confirms create CTA and API gating, standard-role baseline, template compilation, and entitlement filtering. No browser session, live database, deployed-version, or customer-gate checks were performed.

Next:

- Agent `/root/reimbursement_self_service` owns implementation in `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-reimbursement-self-service-all-roles`, branch `codex/reimbursement-self-service-all-roles`, created from freshly fetched `origin/develop` at `a53bb992fc04713d7cba2f2b19c08286f27c08e5`.
- Follow ponytail full using the available repo skill (the legacy configured `/Users/spare058/WatchDog-BMS` skill path is absent); document the expanded company-member self-service rule before code changes. Cover existing persisted roles and new/custom/read-only company roles, effective permissions, full own-claim create/submit prerequisites, and accurate denied/feature-off empty states. Preserve tenant, membership, branch, ownership, entitlement, approval, and payment boundaries.
- Verify focused role/permission/API/frontend regressions and a safe local browser path when available. Record actual commands and evidence in the implementation branch's `docs/agent-memory/reimbursement-self-service-all-roles.md`.
- Coordinate develop integration with WHT/mixed-VAT first and VAT-included navigation next; fetch and incorporate latest develop, rerun impacted checks, then push normally without force or bypassing protection. Do not touch the dirty root `plan` worktree, another user's develop checkout, package.json, live database, or deployment state.
