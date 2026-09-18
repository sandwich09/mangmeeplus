# Agent Memory: LINE signup discovery source

Status: Implemented and locally verified; not deployed.
Owner: thawatchai + Codex
Scope: Existing LIFF signup → validated attribution → persisted signup request → token-owned progress/admin queue/permanent Admin Console company details.
Decisions:
- Website, IG, TikTok, Facebook, อื่น ๆ; single choice, optional as in the approved demo. Other text is optional and limited to 200 characters.
- Use separate nullable discoverySource/discoverySourceOther columns; preserve source and referralCode, optional email, identity/approval/legal boundaries.
- Preserve omitted-field legacy hashes; include provided attribution in replay equality and preserve it during email correction. New ADD_SHOP clears the selection.
- Ponytail full; preserve prior summary changes and unrelated work. No package.json edits or deployment.
- User clarified that company detail in Admin Console must retain visibility after signup approval; read the earliest company-linked request without state filters under existing dashboard permission. Legacy/manual companies show ไม่ระบุ.
Open questions: None blocking implementation.
Artifacts:
- Parent spec/plan contain the dated amendment.
- Approved demo: /Users/thawatchai/.codex/visualizations/2026/09/17/01a0afe3-7a8e-7043-9058-00e572001608/line-signup-referral-demo.html
Verification:
- `pnpm --filter @watchdog-bms/contracts build` and `cd apps/api && pnpm exec prisma generate` — passed.
- `pnpm --filter @watchdog-bms/api typecheck` and `pnpm --filter @watchdog-bms/web typecheck` — passed. Logs: `/tmp/line-discovery-api-typecheck.log`, `/tmp/line-discovery-web-typecheck.log`.
- API focused checks: `cd apps/api && pnpm exec tsx --test --test-reporter=tap src/common/security/liff-start-handoff.spec.ts src/common/security/liff-page-contrast.spec.ts src/modules/auth/line-liff-signup.spec.ts src/modules/external-signup/domain/line-signup.logic.spec.ts src/modules/external-signup/application/submit-line-signup.use-case.spec.ts src/modules/external-signup/application/signup-admin-queue.use-case.spec.ts src/modules/external-signup/presentation/http/public-line-signup.controller.spec.ts src/modules/system-partner-management/application/use-cases/get-partner-detail.use-case.spec.ts src/modules/system-partner-management/presentation/http/partner.controller.spec.ts` — 241 passed, zero skipped. Covers choices, normalization, invalid input, replay conflict, old fingerprints, email correction, admin queue and company detail/lifecycle mapping. Final shared-script adjustment reran its affected suites: 73 passed (overlapping, not additive). Logs in `/tmp/line-discovery-check/api-tests.tap` and `changed-script-tests.tap`.
- Web checks: `cd apps/web && pnpm exec tsx --test --test-reporter=dot src/features/system-signup-requests/signup-queue.logic.spec.ts src/features/system-partners/PartnerSupportTools.qa.spec.ts` — 64 passed.
- Migration `20260917190000_line_signup_discovery_source`: executed its exact SQL against a temporary table inside a rolled-back transaction in local Docker PostgreSQL. Verified legacy nulls retained, all choices accepted, OTHER nullable, unknown source/stale other/null-source-with-text/201-character text rejected. No persistent local or cloud schema change. Rehearsal script `/tmp/line-discovery-check/migration.sql`.
- Existing browser path `e2e/line-signup-contact-email.spec.ts` — 7 passed with additions for OTHER show/hide/200-char limit, trimmed POST fields, switching channel, and fresh ADD_SHOP reset. Served real current AuthController HTML/CSP and LIFF script through an isolated local HTTP fixture on port 3317; LINE identity and API responses simulated. Command: `API_PORT=3317 pnpm exec playwright test --config /tmp/line-discovery-check/playwright.config.ts`. Screenshot review at 390/1280 px passed; no horizontal overflow.
- Added Admin Console browser regression to `e2e/system-admin.spec.ts`. Normal seeded-auth attempt was blocked by invalid local seed credentials before reaching the feature (also discovered the existing port-3000 server belonged to another checkout). Did not change credentials/services. Verified the current actual Next company component using its own local dev server on 3318, synthetic admin session and controlled detail response instead: OTHER literal HTML-shaped text escaped, TikTok, legacy ไม่ระบุ, 390/1280 px, no page errors/overflow. Runner/evidence: `/tmp/line-discovery-check/admin-browser.mjs`, `admin-browser.log`, `company-discovery-390.png`, `company-discovery-1280.png`. This is simulated UI evidence, not full authenticated integration/provider acceptance.
- Reviewed signup retention: `sweepAbandonedIntake` purges only RECEIVED rows with companyId=null; company-linked attribution is retained. Admin detail continues under `system.partner_dashboard.read`; no new write capability.
- `git diff --check` passed; no package.json edits. Stopped our two local fixture servers and restored generated `apps/web/next-env.d.ts` to its pre-check bytes.
Next:
- Ready for review. Before release, apply the additive migration before code queries the new columns, and rerun the normal seeded-admin browser test in a working local/UAT auth environment.
- No commit, push, cloud access, deployment or customer rollout in this task. Any future UAT/production work must follow the mandatory deployment runbook.
