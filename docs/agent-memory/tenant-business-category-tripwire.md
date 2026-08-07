# Agent Memory: tenant-business-category-tripwire

Status: Code + docs COMPLETE and verified locally. Not committed to `develop`, not
deployed. Live end-to-end alarm path unverified (needs a deployed environment).

Owner: Platform/AI Security lane, worktree `jolly-ritchie-2d34d8`
(branch `claude/laughing-benz-7d9ee5`, merged from `develop` at start of work —
the branch was based on `main` and did not contain the register).

Scope: Closes the tenant-tripwire item in
`docs/security-evidence/p1-ai-processor-lawful-basis-register.md` §6. Data-model addition
(`Company.businessCategory`) + alert at the onboarding seam. Does **not** answer the
deferred PDPA questions it protects.

## Decisions

- **Declared category, not content classification.** The register named both routes;
  classifying `CrmBooking.serviceName`/`CrmMessage.contentText` is weaker (free text, mixed
  Thai/English, per-tenant vocabulary) and more invasive — reading customer message content
  to answer a question about the *tenant's* business type. Asked the party who knows.
- **Prisma enum, not free-text string.** Closed set means a typo'd `"clinic "` cannot slip
  past the health check. Mirrored by `COMPANY_BUSINESS_CATEGORIES` in `packages/contracts`
  (reuse crosses api↔web, which is where the shared-constants guideline says a value stops
  being module-local).
- **Nullable column, required onboarding field.** Pre-existing companies are not backfilled;
  every new one carries a declared value.
- **Reused `emitSecurityEvent` at `riskLevel: HIGH`** — the prod metric filter in
  `deploy.sh` already alarms on `$.riskLevel` and routes to `SECURITY_ALERT_TOPIC_ARN`.
  Zero new infrastructure, which mattered: AWS provisioning is currently constrained
  (see the M-14 ClamAV lane), and an unrun provisioning script is not a tripwire.
- **Rejected the tenant notification system.** `NotificationRule`/`NotificationEvent`/
  `AlertState` are all tenant-scoped (`companyId`, cascade delete) with recipients *inside*
  the tenant. The dev team is not a tenant member, and a compliance-internal concern does
  not belong in a customer's notification feed.
- **Emit after commit**, not inside the transaction: a rolled-back onboarding must not page
  anyone. `emitSecurityEvent` already swallows logger failures, so it cannot 500 a
  completed onboarding.
- **No alert on `OTHER`** — accepted residual, documented in the spec and register §6.1.
  Alerting on it would train the team to ignore the alert.

## Open questions

- Is `SECURITY_ALERT_TOPIC_ARN` actually set in production? If not, the metric filter and
  alarm are never installed and the tripwire emits into a log nobody watches. **Confirm
  before treating this as live.**
- **Backfill for existing companies — now a tracked open item in register §6** (owner asked
  2026-07-28 for it to be a to-do, not a footnote). The tripwire is forward-only, so the
  tenants §5's deferral is actually about have never been checked. Blocker found while
  writing it up: `UpdatePartnerProfileUseCase` writes only `name`/`brandName`/`timezone`/
  `locale`/`phone`/`email`, so **there is no path to set the category on an existing
  company** — either extend that use case (keeps the audit row) or accept a one-off SQL
  backfill (no audit row, which this register objects to elsewhere).

## Artifacts

- `docs/specs/tenant-business-category-tripwire-spec.md` (new)
- `docs/plans/tenant-business-category-tripwire-plan.md` (new)
- `docs/security-evidence/p1-ai-processor-lawful-basis-register.md` — §6 checkbox ticked,
  §6.1 evidence section added
- `packages/contracts/src/company-profile.ts` (new) + `index.ts` export
- `apps/api/prisma/schema.prisma` — `enum CompanyBusinessCategory`, `Company.businessCategory`
- `apps/api/prisma/migrations/20260728210000_company_business_category/migration.sql` (new)
- `apps/api/src/common/logger/security-event.ts` **and**
  `apps/ai-gateway/src/common/logger/security-event.ts` — new catalogue entry, byte-identical
- `apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts`
- `apps/api/src/modules/system-onboarding/presentation/http/system-onboarding.controller.ts`
- `apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.spec.ts`
- `apps/web/src/features/system-onboarding/SystemOnboardingNewPage.tsx`
- `e2e/system-admin.spec.ts` — SYS-03 selects `RETAIL` (form no longer submits uncategorised;
  `RETAIL` chosen so the e2e run does not page the dev team)

## Verification

Run 2026-07-28, Node v22.14.0, worktree already had `node_modules` + generated Prisma.

- `npx prisma generate` — OK (Prisma Client 7.8.0)
- contracts `tsc -p tsconfig.json` — OK (api/web import built `dist`, so contracts must be
  rebuilt before either typecheck)
- `create-company-onboarding.spec.ts` — **18/18 pass** (3 health-adjacent emit exactly one
  HIGH event with expected fields; 4 non-health emit none; category on company create +
  audit metadata)
- `security-event.spec.ts` + `security-event-emitters.spec.ts` — **23/23 pass**
  (byte-identity across both apps, alarm-coverage guard)
- Full `apps/api` suite — **exit 0, zero failures**
- `tsc --noEmit` api — clean; web — one pre-existing error only (`heic2any` declared in
  `apps/web/package.json` but not installed in this checkout **or** the main one), touched
  files clean

Not run: browser check of the onboarding form; live onboard-a-clinic → CloudWatch → SNS path.

## Next

1. Commit and open a PR onto `develop` (the register lives there; `main`-based
   branches do not have it).
2. Confirm `SECURITY_ALERT_TOPIC_ARN` is set for production.
3. Migration is additive and idempotent — safe under the dirty-tree drift-heal pattern, but
   still migrate the e2e DB before any e2e run (new enum + column).
4. Backfill existing companies (register §6 open item) — needs a human decision per
   company plus a way to enter it; see Open questions.
5. Optional, deliberately not built: periodic review sweep of `OTHER`/uncategorised tenants.
