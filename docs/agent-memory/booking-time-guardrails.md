# Agent Memory: Booking Time Guardrails

Status: Implemented and focused-verified 2026-07-12; migration created but not applied.
Owner: thawatchai
Scope: Manual booking, reschedule, availability, and CRM customer AI auto-booking time rules.
Decisions: Start must be now or later. “ห่างกัน 1 ชม.” means a company-level empty buffer after each booking, default 60 minutes and selectable as 0/30/60/90/120 minutes on the online-booking page. Duration keeps the existing 1–3 hour range in 30-minute increments. Manual, reschedule, availability, atomic conflict checks, and AI auto-booking must load the same persisted setting.
Open questions: None.
Artifacts: `docs/specs/crm-line-oa-customer-os-spec.md` §30; `docs/plans/crm-line-oa-customer-os-plan.md` Phase 6/8C; migration `20260712110000_company_booking_buffer`; booking settings contracts/API; `BookingsPrototypePage` selector; shared booking domain/repository and CRM AI autonomy paths.
Verification: Prisma validate PASS; contracts build PASS; API/web/AI Gateway typecheck PASS; focused API booking + inbound AI suites 107/107 PASS; AI Gateway booking extract 3/3 PASS; web booking model 3/3 PASS; `git diff --check` PASS.
Next: Apply the migration through the normal deploy path, then browser-smoke changing 0/30/60/90/120 minutes and confirm manual + AI availability reflect it against real DB rows.
