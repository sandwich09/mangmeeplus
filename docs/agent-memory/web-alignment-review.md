# Agent Memory: web-alignment-review

Status: Updated docs.
Owner: Codex main thread emulating BA -> SA -> DEV -> Integration.
Scope: Review and clean alignment for web task/spec, UI/template choice, and web journey.
Role gate status:
- BA: Web journey remains full Business OS workspace; LINE/LIFF remains assistant/deep-link channel.
- SA: Spec/plan align routes, permissions, API states, TailAdmin template, and Auth/RBAC boundaries.
- DEV: Ponytail read; smallest diff updated docs and one UI status copy.
- Integration: Web typecheck passed; no E2E needed because workspace implementation was not built.
Decisions:
- Web remains full Business OS workspace.
- LINE/LIFF remains assistant, alert, auth bridge, and deep-link channel.
- TailAdmin is template for dense admin shell/common UI only; demo ecommerce/auth/pages are excluded.
- Root `/` platform status page remains bootstrap-only until auth/default company routing exists.
- Company-scoped workspace starts at `/companies/[companyId]/dashboard`.
- Notification entry in item 03 may be layout placeholder only; item 06 owns real notification center.
Open questions:
- Human-readable company slug can be considered later; item 03 keeps opaque `companyId`.
- Settings route in item 03 should stay placeholder unless Auth/RBAC screens already exist.
Artifacts:
- `docs/specs/web-core-workspace-spec.md`
- `docs/plans/web-core-workspace-plan.md`
- `docs/_templates/feature-spec-template.md`
- `docs/_templates/implementation-plan-template.md`
- `docs/prompts/feature-spec-template.md`
- `docs/guidelines/web-frontend-code-style.md`
- `apps/web/src/features/platform-foundation/platform-foundation.constants.ts`
Verification:
- `pnpm --filter @watchdog-bms/web typecheck` passed.
Next:
- If implementation starts, run Web Core Workspace Plan Phase 0 first and verify with web typecheck/build after code changes.
