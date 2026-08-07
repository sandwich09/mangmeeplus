# Agent Memory: CRM product and service catalog

Status: Core implemented and focused-verified locally; live verification pending
Owner: Product owner
Scope: Shared Product/Service catalog for CRM Settings, staff booking selection, and bounded CRM customer AI context.
Decisions:
- Reuse Inventory `Product`; `kind = SERVICE` is the service record.
- Customer publication is explicit per item and defaults off.
- Keep booking `serviceName` as a historical snapshot; validate selection against the current published catalog before create.
- Keep AI Gateway database-free; ERP Core assembles and bounds catalog context.
- Treat `inventory.product.read|manage` as shared catalog permissions enabled by either CRM or Inventory; CRM-only access shows CRM Settings without exposing the Inventory workspace.
Open questions: None blocking for the approved MVP slice.
Artifacts:
- `docs/specs/crm-product-service-catalog-spec.md`
- `docs/plans/crm-product-service-catalog-plan.md`
Verification:
- Contracts build passed.
- Prisma generate and validate passed.
- API, AI Gateway, and web TypeScript checks passed.
- API focused tests: 92 passed (catalog id revalidation, CRM AI assist context, inbound/auto-booking integration).
- AI Gateway focused tests: 19 passed (bounded catalog prompt and internal request validation).
- Web focused tests: 18 passed (permission-gated CRM Settings navigation and booking model).
- CRM entitlement regression tests: API feature gate 11 passed; web navigation 15 passed; API/Web typechecks passed.
- Local browser smoke 2026-07-13: product create -> detail redirect -> update -> list passed on the shared catalog UI; the temporary smoke row was removed afterward.
- `git diff --check` passed.
Next: Deploy migration `20260712130000_crm_product_service_catalog`, then browser-smoke CRM Settings create/edit -> booking selection and real-model product/service answer -> booking confirmation. Keep item 15A unchecked until live evidence is recorded.
