# Agent Memory: Company business type and Admin Console profile

Status: Implemented and locally verified; not deployed.
Owner: thawatchai + Codex
Scope: Company settings shop form → DBD TSIC/OTHER persistence → current company details in Admin Console.
Decisions:
- Follow ponytail full, existing identity controller/use case and ThemedSelect; no dependencies/package.json edits.
- Official 5-digit TSIC, 1,098 records from 21 SearchCategory responses; snapshot is independent of existing businessCategory tripwire.
- Dedicated versioned business-type PATCH avoids altering tax legal-identity revisions/latches. Existing manage/read and tenant boundaries apply.
- Include all six address fields and current VAT summary in admin information; account secrets excluded.
- Preserve earlier uncommitted summary/discovery-source work and unrelated workspace changes. No cloud/deploy.
Open questions: None blocking.
Artifacts:
- [Spec](../specs/company-business-type-admin-profile-spec-th.md), [plan](../plans/company-business-type-admin-profile-plan-th.md).
- `packages/contracts/src/dbd-tsic-master.ts`: official 1,098-code snapshot, source endpoints/extraction fields/SHA-256 in header. Full 5-digit activities, not only A–U sections.
- Additive migration `20260917200000_company_business_type`; shared business-type validator/label, existing identity HTTP/use case, company profile save plan, Admin Console current-company mapping.
- Existing `ThemedSelect` supports opt-in search, keyboard selection/Escape, no-results feedback; searchable `PopoverPanel` matches its anchor width so filtered results stay aligned. Other select/date/info popovers retain their width behavior.
- Official raw snapshots/extraction script, isolated QA servers/scripts/logs and screenshots in `/tmp/company-tsic-check/`. Reviewed `dropdown-preview.png`, `company-other-preview.png`, `admin-company-preview.png`, plus 390/1280 integration captures.
Verification:
- `pnpm --filter @watchdog-bms/contracts build` and `pnpm --filter @watchdog-bms/api typecheck` / `pnpm --filter @watchdog-bms/web typecheck`: PASS. Prisma client generation PASS.
- From `apps/api`: `pnpm exec tsx --test --test-reporter=tap src/modules/data-model-core/application/use-cases/company-identity.use-case.spec.ts src/modules/data-model-core/presentation/http/company-business-type.controller.spec.ts src/modules/system-partner-management/application/use-cases/get-partner-detail.use-case.spec.ts src/modules/system-partner-management/presentation/http/partner.controller.spec.ts` — 39 tests PASS, none skipped.
- From `apps/web`: `pnpm exec tsx --test --test-reporter=tap src/features/company-profile/company-profile.logic.spec.ts src/features/company-profile/CompanyProfilePage.qa.spec.ts src/common/components/field/ThemedSelect.spec.ts src/features/system-partners/PartnerSupportTools.qa.spec.ts` — 103 tests PASS, none skipped.
- Root `pnpm exec tsx --test --test-reporter=tap packages/contracts/src/company-business-type.spec.ts` — master integrity/normalization/label test PASS.
- Exact migration + actual Prisma/use case against an isolated temporary schema on local PostgreSQL: concurrent same-version writes produce one success/one conflict; audit failure rolls back, OTHER/null/check constraints hold; legal version and onboarding policy category unchanged. Temporary schema removed in finally. No existing company data changed. Command from `apps/api`: `pnpm exec tsx --tsconfig tsconfig.json /tmp/company-tsic-check/migration-cas.ts`.
- `node /tmp/company-tsic-check/browser.mjs`: actual Next profile/admin pages with actual identity/business-type/admin use cases and a synthetic session/in-memory repository. PASS: TSIC code search/keyboard, six address fields/name/tax/VAT, save/reload, OTHER required/retained after failed request, escaped text, switch back clears stale OTHER, admin mirrors current values at 390/1280 with no overflow. This is isolated integration evidence, not live Stripe/production E2E.
- `node /tmp/company-tsic-check/preview.mjs`: PASS search Home/End retain input focus, Escape returns to trigger, dropdown anchor/width alignment and profile overflow at 390/1280; final images visually inspected. Initial fixture-only assertions used a shortened DBD rice label and assumed Mac End-key cursor behavior; corrected to official label/native focus behavior.
- `git diff --check`: PASS; no package.json edits.
Next:
- Review/integrate these workspace changes with earlier uncommitted discovery-source work; apply both additive migrations before the new API readers in any intended runtime. No commit/push/UAT/Production deploy performed. Existing localhost:3000/3001 checkout remains untouched.
- Follow-up user asks for recommendations on pre-purchase company completeness: recorded separately in `billing-company-profile-gate-2026-09-17.md`; no billing change included here.
