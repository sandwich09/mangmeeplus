# Agent Memory: Booking Canonical Customer Link

Status: DONE — code/docs/local verification complete; production deploy remains under the existing item-15A launch gate.
Owner: Product owner / Codex
Scope: Close the gap where staff bookings can be stored by customer name only; make every confirmed booking reference a canonical same-company CRM customer across staff and LINE paths.
Decisions:
- `CrmBooking.customerId` becomes required with a database foreign key; `customerName` remains a display snapshot only.
- Staff UI selects an active CRM customer or explicitly quick-creates one through the existing customer API. Phone is optional but captured and normalized by the existing use case when supplied.
- LINE keeps its identity -> customer -> conversation path and the final booking use case re-validates the customer.
- Staff source values are STAFF, WEB, PHONE, FACEBOOK, WALK_IN, OTHER. LINE is server-only.
- Legacy null-customer bookings get one provisional customer per booking; do not infer identity from names.
Open questions: None.
Artifacts:
- `docs/specs/crm-line-oa-customer-os-spec.md` §31
- `docs/plans/crm-line-oa-customer-os-plan.md` canonical-customer gap closure
- Prisma schema/migration, CRM booking contracts/use cases/repository, booking web page and focused tests
Verification:
- `prisma validate --schema apps/api/prisma/schema.prisma` — PASS.
- `prisma generate --schema apps/api/prisma/schema.prisma` — PASS.
- Fresh temporary PostgreSQL database: all 51 migrations deployed successfully in final order, ending with `20260712140000_crm_booking_canonical_customer`; temporary database removed afterward.
- Typecheck — PASS: contracts, API, web.
- Focused tests — PASS 76/76: booking use cases/repository plus LINE inbound/autonomous booking integration.
- Browser smoke at local seeded OWNER `/companies/seed-local-company/bookings` — PASS: modal opens; customer search returns name + phone; selecting shows canonical link state; source changes to PHONE; explicit quick-create shows phone input; zero browser console errors. No test customer or booking was submitted.
Next: Apply the migration during the existing item-15A production deploy and include one live booking/customer-360 smoke in that launch evidence. No code gap remains for canonical booking customer linkage.
