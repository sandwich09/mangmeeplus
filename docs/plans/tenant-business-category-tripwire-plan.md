# Plan: Tenant business-category tripwire

Spec: `docs/specs/tenant-business-category-tripwire-spec.md`. Ponytail full: shortest
correct diff, existing patterns only, no new dependency, no new permission key, no new
alerting infrastructure.

## Steps

1. **Shared constants** — `packages/contracts/src/company-profile.ts` (new, exported from
   `index.ts`): `COMPANY_BUSINESS_CATEGORIES`, `CompanyBusinessCategory` type,
   `HEALTH_ADJACENT_BUSINESS_CATEGORIES`, `isHealthAdjacentBusinessCategory()`.
   Contracts is the right home per the shared-constants guideline: reuse crosses the
   api↔web boundary (API validates and classifies, web renders the option list), so a
   module-local constant would drift.
2. **Schema + migration**
   - `apps/api/prisma/schema.prisma`: `enum CompanyBusinessCategory` + nullable
     `businessCategory` on `Company`.
   - New migration `20260728210000_company_business_category/migration.sql`, idempotent
     (`DO $$ ... CREATE TYPE ... EXCEPTION WHEN duplicate_object`, then
     `ADD COLUMN IF NOT EXISTS`) with the why-comment, matching the house style.
3. **Tripwire + persistence** — `create-company-onboarding.use-case.ts`
   - Command gains `businessCategory: CompanyBusinessCategory` (required).
   - `tx.company.create` persists it; audit `metadataJson` gains `businessCategory`.
   - After the transaction resolves: if `isHealthAdjacentBusinessCategory(...)` →
     `emitSecurityEvent(new Logger(CreateCompanyOnboardingUseCase.name),
     SECURITY_EVENT.pdpaHealthAdjacentTenantOnboarded, 'HIGH', { ... })`.
     Uses the `CreateWorkflowWebhookEndpointUseCase` precedent — `new Logger()` bridged to
     pino by M-02, so no DI or module change.
4. **Event catalogue** — add `pdpaHealthAdjacentTenantOnboarded:
   'pdpa.tenant.health_adjacent_onboarded'` to `security-event.ts` in **both**
   `apps/api` and `apps/ai-gateway`, byte-identically (cross-app guard test enforces it).
   No `deploy.sh` change: the alarm's `$.riskLevel = "HIGH"` clause already covers it, and
   the coverage guard is explicitly one-directional (a catalogued event may be log-only).
5. **API boundary** — `system-onboarding.controller.ts`: `CreateOnboardingDto` gains
   `@IsIn(COMPANY_BUSINESS_CATEGORIES) businessCategory!: CompanyBusinessCategory`
   (required), passed through to the use case.
6. **Web** — `SystemOnboardingNewPage.tsx`: required `<select>` with an empty placeholder
   option, Thai/English labels, wired into the POST body.
7. **e2e** — `e2e/system-admin.spec.ts` SYS-03 selects a category before submitting
   (the form now rejects submit without one).
8. **Docs** — register §6 checkbox + evidence; task memory file.

## Verification

- Extend `create-company-onboarding.spec.ts` (already in the api test list — no
  registration needed; an unregistered new spec silently never runs): health-adjacent
  category emits the event with `riskLevel: HIGH`; non-health emits nothing; category
  lands on the company create args and the audit metadata. Capture via
  `Logger.overrideLogger`, the `security-event-emitters.spec.ts` precedent.
- `security-event.spec.ts` byte-identity + alarm-coverage guards must stay green.
- `tsc --noEmit` for contracts, api, web.
- Full api suite (contracts rebuild first — the api imports built contracts).
- Browser check of the onboarding form if a dev server is available.

## Deploy notes (not this change)

- Migration is additive and idempotent — safe under the dirty-tree drift heal pattern.
- No template sync (no new permission key). No AI Gateway behaviour change, but the
  gateway image **does** need rebuilding if it ships `security-event.ts` — the edit is
  catalogue-only and unused there, so gateway deploy is not a prerequisite for the alarm.
- The alert only reaches the dev team in an environment where
  `SECURITY_ALERT_TOPIC_ARN` is set (that is what installs the metric filter/alarm at
  deploy time). Confirm it is set for production before relying on the tripwire.
