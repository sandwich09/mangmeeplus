# Agent Memory: LINE second-shop button + AUTO_FREE on UAT

Status: Implemented and pushed on `codex/line-second-shop-button-auto-free-uat`; no PR opened (Owner instruction). Not deployed.
Owner: MangmeeDev
Scope: Two Owner-ordered changes, both under "every environment value comes from that environment's config, and nothing UAT-only may reach production".

Decisions:
- **Part 1 — "เปิดร้านใหม่" on the บริษัทของฉัน card.** `CompanyContextCard` gains one optional
  `newShopSignupUrl`; `buildCompanyContextMessage` renders a single footer button only when it is
  set. The URL is built in `ProcessLineWebhookUseCase.newShopSignupUrl()` from
  `config.lineLiffId` (validated with the door card's `LIFF_ID_PATTERN`) and
  `config.externalSignupEnabled` — the same switch `POST /v1/public/company-signups` answers with
  `external_signup_disabled`. Gating in the use case, not the domain logic, keeps
  `line-staff-menu.logic.ts` free of an import cycle back into `line-business-card.logic.ts`.
- The door card is untouched. The button reuses the SAME central LIFF page
  (`https://liff.line.me/<LINE_LIFF_ID>/signup`); `submit-line-signup.use-case.ts` already attaches a
  second shop to the account the LINE identity proves (`attachUserId`), so no new backend path.
- No id, company, token or query string travels in the URL (LINE-ONBOARD-01).
- **Part 2 — `LINE_SIGNUP_APPROVAL_MODE`** takes the `EXTERNAL_SIGNUP_ENABLED` shape in
  `infra/prod-ecs-express/deploy.sh`: empty input resolves to `AUTO_FREE` on `DEPLOY_ENV=uat` and
  `MANUAL` everywhere else, an explicit value is still validated as `MANUAL|AUTO_FREE`, and
  `DEPLOY_ENV=production` with `AUTO_FREE` exits 2 with
  `LINE_SIGNUP_APPROVAL_MODE=AUTO_FREE is not activated for production yet`.

Open questions:
- Live confirmation that UAT still has at least one ACTIVE `SYSTEM_ADMIN` membership on an ACTIVE
  user is not available from a describe-only posture (needs the UAT DB tunnel). See Verification.

Artifacts:
- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts` (+ `.spec.ts`)
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` (+ `.spec.ts`)
- `infra/prod-ecs-express/deploy.sh`, `infra/prod-ecs-express/production-serving-mode.spec.sh`
- Pin re-sync rewrote `.github/workflows/deploy-production.yml` and
  `infra/security/validate-production-maintenance-release.sh`.

Verification:
- `line-staff-menu.logic.spec.ts` 38/38; `process-line-webhook.use-case.spec.ts` 197/197.
- `src/spec-suite-coverage.spec.ts` 3/3; `check-di-metadata.mjs` 794 files / 870 classes clean.
- api `typecheck` clean; full api fixed list under `/tmp/mangmee-heavy.lock`: 8,185 passing, 0 fail.
- `production-serving-mode.spec.sh` PASS (includes the new production `AUTO_FREE` refusal case and
  the two grep pins on the new deploy.sh lines).
- Resolved-mode probe on the real deploy.sh prologue: `uat -> AUTO_FREE`, `production -> MANUAL`,
  `DEPLOY_ENV` unset -> `MANUAL`, `uat` + explicit `MANUAL` -> `MANUAL`, `production` + explicit
  `AUTO_FREE` -> ERROR. `staging` is still refused earlier by the existing `DEPLOY_ENV` guard.
- `sync-production-maintenance-release-pins.mjs --check` ends `exactFiles=45 status=current`.
- `git diff --check` clean.
- Live UAT (describe-only, `AWS_PROFILE=watchdog-bedrock`, express-gateway api-web revision
  `.../task-definition/watchdog-bms-uat-watchdog-bms-uat-api-web:182`):
  `EXTERNAL_SIGNUP_ENABLED=true`, `LINE_SIGNUP_ENABLED=true`,
  `LINE_LIFF_ID=2010784350-ruzn5beM`, `LINE_SIGNUP_APPROVAL_MODE=MANUAL` (today),
  `LINE_SIGNUP_AUTO_DAILY_CAP=20`, `LINE_FREE_AI_BUDGET_SATANG=8000`.

AUTO_FREE runtime requirements (`submit-line-signup.use-case.ts` `decideAndRun`):
1. An operator of record — the first row of `SignupAdminNotifyService.activeSystemAdmins()`
   (`CompanyMembership.status=ACTIVE` AND `user.status=ACTIVE` AND a role with key `SYSTEM_ADMIN`).
   It is resolved BEFORE a cap slot is claimed; with none, the audit writes
   `signup.line.auto_approve_no_actor` and the application falls back to `PENDING_REVIEW`.
   A LINE link is NOT required — `activeSystemAdmins()` never reads `ExternalIdentity`.
2. `LINE_SIGNUP_AUTO_DAILY_CAP` (`AppConfigService.lineSignupAutoDailyCap`), default **20** in both
   `packages/config/src/index.ts` and `deploy.sh`; `0` is legal and means "queue everything".
   The slot is claimed under `pg_advisory_xact_lock` keyed on the Bangkok day; over cap the audit
   writes `signup.line.auto_approve_capped`, one `auto_cap_reached` ops alert per day, then MANUAL.
3. A repeat trial for the same LINE account always falls back to the queue, AUTO_FREE or not.

UAT readiness: (2) satisfied live (cap 20). (1) satisfied per
`docs/agent-memory/system-admin-cutover-uat-prod.md` — `uatmangmeeplus` (user id
`cmt8cpfkd000066k18ekt5rqy`) was provisioned and its `SYSTEM_ADMIN` resolution verified on UAT
2026-08-25 — but NOT re-confirmed live here. The only live signal in the 3-day UAT log window is
`signup.support.notified … lineNotifiedCount:0` (2026-09-05), which says no SYSTEM_ADMIN has an
ACTIVE LINE identity; it does not distinguish "no admin" from "no linked admin" and does not affect
AUTO_FREE. Confirm before the first AUTO_FREE UAT deploy:

```sh
psql "$(infra/uat/db-port-forward.sh --url)" -c 'SELECT cm."userId", cm."companyId" FROM "CompanyMembership" cm JOIN "User" u ON u.id = cm."userId" JOIN "MembershipRole" mr ON mr."membershipId" = cm.id JOIN "Role" r ON r.id = mr."roleId" WHERE cm.status = $$ACTIVE$$ AND u.status = $$ACTIVE$$ AND r.key = $$SYSTEM_ADMIN$$ ORDER BY cm."userId";'
```

Next:
- Owner decides when to deploy UAT; the next UAT deploy flips `LINE_SIGNUP_APPROVAL_MODE` to
  `AUTO_FREE` with no flag exported, and puts "เปิดร้านใหม่" on the UAT บริษัทของฉัน card.
- Production stays `MANUAL` with no button: `EXTERNAL_SIGNUP_ENABLED` is false there and both
  `EXTERNAL_SIGNUP_ENABLED=true` and `LINE_SIGNUP_APPROVAL_MODE=AUTO_FREE` are refused by deploy.sh.
