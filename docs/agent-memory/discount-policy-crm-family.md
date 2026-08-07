# Agent Memory: discount-policy-crm-family

Status: IMPLEMENTED AND VERIFIED (unit) — not deployed
Owner: Claude
Scope: Move the นโยบายส่วนลด menu out of the foundation (never-sellable) set and into the CRM family, so its menu, its package card, and its API close together.

Decisions:
- UAT report: on a CRM-off company the นโยบายส่วนลด menu still showed and the page answered
  `โหลดนโยบายส่วนลดไม่สำเร็จ`. Cause was a gate mismatch, not a page bug:
  - `MENU_ENTITLEMENT_BINDINGS.discount` was `parentFeatureKey: null` / `entitlementKeys: []` —
    a *foundation* binding, which by construction no company can switch off.
  - Its gate was `company.setup.read`, a key every role holds.
  - `BusinessPolicyController` enforces `crm.customer.read` (GET) and `crm.customer.update` (PUT),
    and `crm.*` is stripped by `filterPermissionsByEntitlement` when the CRM family is off.
  So the menu was permanently visible and the page permanently un-loadable on CRM-off companies.
- Fix mirrors the existing `customers` (ลูกค้า) binding rather than inventing a shape:
  `parentFeatureKey: 'crm'`, `entitlementKeys: ['crm.customers']`, `gatePermissions: ['crm.customer.read']`.
  `crm.customer.read` is a `crm.customers` submenu key, so it is denied when either the `crm` parent
  or the `crm.customers` child is off — the menu closes with CRM either way.
- API contract left unchanged: the fix aligns the menu to the permission the API already enforces.
- `status: 'planned'` left unchanged (out of scope).
- No Prisma/schema/migration change, no new permission key, no new dependency.

Open questions:
- None for the code. Product/ops: any UAT company that should keep นโยบายส่วนลด now needs the CRM
  family (`crm` + `crm.customers`) enabled — this is the same owner-gated entitlement flip already
  tracked for the other families.

Artifacts:
- `packages/contracts/src/menu-entitlements.ts` — discount binding moved into the CRM family.
- `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts` — nav gate now
  `crm.customer.read` (kept in parity with the binding by the existing alignment test).
- `apps/api/src/modules/employee-access/domain/logic/menu-entitlement-binding.spec.ts` — foundation
  list pinned to exactly `['settings']` so a menu cannot silently become un-sellable again.
- `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts` — deep-link gate test.

Verification:
- `packages/contracts`: `pnpm build` (dist is what apps resolve; specs read stale dist otherwise).
- `apps/api`: `npx tsx --test .../menu-entitlement-binding.spec.ts .../feature-gate.logic.spec.ts`
  → 44 pass / 0 fail. Covers the sellable-binding strip test, which `discount` now participates in.
- `apps/web`: `npx tsx --test .../web-core-workspace.spec.ts .../system-partners.logic.spec.ts
  .../discount-policy.model.spec.ts` → 93 pass / 0 fail.
- Behavioural probe of `filterPermissionsByEntitlement(['crm.customer.read'], …)`:
  all entitlements → `['crm.customer.read']`; `crm` off → `[]`; `crm.customers` off → `[]`.
- `apps/api` `tsc --noEmit` reported 9 pre-existing errors unrelated to this change (none in files
  touched here). They were cleared separately in the same session — see the follow-up below — and
  `tsc --noEmit` now exits 0.

Follow-up (same session) — `apps/api` typecheck restored to 0 errors:
- The generated Prisma client at `apps/api/src/generated/prisma` (gitignored build artifact, not
  checked in) was stale: `schema.prisma` and migration `20260804150000_ai_turn_intent_correction`
  both carry `AiTurnIntent.CORRECTION`, the client did not. Regenerated with
  `DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" pnpm prisma generate` in `apps/api`
  (generate needs a URL present, not a reachable database). No latent production bug: schema,
  migration (`ADD VALUE IF NOT EXISTS`) and `process-line-webhook.use-case.ts` all agree; only the
  local artifact lagged.
- `company-vat-registration.logic.spec.ts` read `.kind` off `VatFactPlan | VatFactRejection`, and
  only the plan branch has it. Added an `asPlan()` narrowing helper in the spec (7 call sites).
  Assertion semantics unchanged — a rejection still fails, now printing the rejection.
- `prisma-reimbursement.repository.ts:1316` — `request.lines` is `lines?:` on the record;
  `request.lines.length` became `!request.lines?.length`. Inside the retained-but-unreachable legacy
  approval body (the method throws `legacy_reimbursement_approval_path_disabled` first), so no
  reachable path changes; absent now reads as empty instead of a TypeError.
- Verified: `apps/api` `tsc --noEmit` exit 0 (was 9 errors); VAT spec 16/16;
  reimbursement atomic-lines spec 3/3.

Next:
- Deploy with the normal UAT path, then confirm on a CRM-off company that the menu is gone and a
  direct hit on `/companies/<id>/settings/discount-policy` redirects to the dashboard
  (`WorkspaceLayout` already redirects when `canAccessWorkspacePath` is false).
- Decide, per company, whether CRM should be enabled for the UAT set that needs discount policy.
