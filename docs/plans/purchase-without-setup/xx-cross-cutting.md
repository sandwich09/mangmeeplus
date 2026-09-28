# ข้ามทุก PR (A–E): ลงทะเบียนเทสต์, pins, ci.yml parity, migrations, contracts, readbacks, UAT/production, docs, release

- Spec: [../../specs/mangmee-purchase-without-setup-spec-th.md](../../specs/mangmee-purchase-without-setup-spec-th.md) §18.1 "ข้ามระบบ", §18.3 RV12/RV13/RV17/RV18/RV31/RV34/RV35, §18.4 DQ6 · Plan: [../mangmee-purchase-without-setup-plan-th.md](../mangmee-purchase-without-setup-plan-th.md) P0/P6 · Runbook: [../../runbooks/uat-production-v2-deployment.md](../../runbooks/uat-production-v2-deployment.md)
- ฐาน: `origin/develop` ddcdcadf; ทุกบรรทัดตรวจกับไฟล์จริง 2026-09-27; คำสั่ง `--check` ของ pins รันจริงในวันเดียวกัน (§2)
- ใช้คู่กับ brief ของแต่ละ PR; ชื่อไฟล์เทสต์ใหม่ของ PR A–D ในเอกสารนี้เป็น **ชื่อคาดการณ์** — ผู้ implement ต้องใช้ชื่อจริงจาก brief ของ PR นั้น แต่ตำแหน่งลงทะเบียนไม่เปลี่ยน

## 1. การลงทะเบียนเทสต์ (RV13) — ห้ามแตะ `package.json`

### 1.1 กฎที่บังคับ (ตรวจแล้ว)
- `apps/api/src/spec-suite-coverage.spec.ts:43-75`: ทุก `apps/api/src/**/*.spec.ts` ต้องถูกอ้างชื่อ (`src/<path>`) ในอย่างน้อยหนึ่งแห่ง: script `--test` ใน `apps/api/package.json` (`:44-49`), `scripts/line-ai-whole-chain-acceptance.catalog.mjs` (`:50-52`), `.github/workflows/ci.yml` (`:53`), `.github/workflows/extended-tests.yml` (`:54-56`); ไม่พบ → CI แดง (`:70-74`). ยกเว้นเฉพาะ `*.pg.spec.ts` (`:19-21`); `*.postgres.spec.ts` **ไม่ยกเว้น** (ของเดิม `billing-email-recipient.postgres.spec.ts` ถูกชื่อไว้ใน `extended-tests.yml:259-268`)
- unit spec ที่ชื่อใน catalog รันโดย job "Acceptance Checks" (`ci.yml:553-554` `node scripts/run-line-ai-whole-chain-acceptance.mjs`); ชื่อใน `ci.yml:541-547` รันในขั้น "Test company profile, discovery and billing prerequisites" / "Test billing and partner pagination"
- contracts spec: `packages/contracts/package.json:17` เป็นรายการตายตัว (ห้ามแก้) และไม่มีอะไร police → spec ใหม่ใน `packages/contracts/src/*.spec.ts` ต้องถูกชื่อใน `ci.yml:543`
- `*.pg.spec.ts` ไม่รันที่ไหนเองเลย → ต้องมี invocation ของตัวเองใน job "Migrations and Boot" (pattern `ci.yml:766-778`: DB `watchdog_step0_ci` ที่ `migrate deploy` จากศูนย์ `:772-773` แล้ว `SALES_CONSOLE_TEST_DATABASE_URL="$DATABASE_URL" pnpm --filter @watchdog-bms/api exec tsx --test src/modules/sales-console/sales-console.pg.spec.ts` `:777-778`) หรือใน `extended-tests.yml` (manual, ไม่ใช่ release gate `:3-5`)
- smoke: `apps/api/src/scripts/billing-http-smoke.ts:207-258` เลือกชุดด้วย env `BILLING_*_ONLY=1` แล้ว `return` — smoke ใหม่ = ฟังก์ชัน `checkBillingNoSetup()` ในไฟล์ `apps/api/src/scripts/billing-no-setup-smoke.ts` เรียกจาก selector ใหม่ `BILLING_NO_SETUP_ONLY=1` (บล็อกใหม่หน้า `:207`) + step ใน `extended-tests.yml`
- e2e: `playwright.config.ts:87-92` project `chromium` เลือกทุก spec อัตโนมัติ (ยกเว้น `evidence.spec.ts`) แต่ workflow รัน Playwright **จุดเดียว** = `extended-tests.yml:309` (`pnpm exec playwright test e2e/line-signup-contact-email.spec.ts --workers=1`) → e2e ใหม่ต้องมี step ของตัวเอง; 390px ทำใน spec ด้วย `setViewportSize` (ตัวอย่าง `e2e/billing-admin-directory.spec.ts:74`)
- web spec: glob ของ `apps/web` รันเอง (ไม่ต้องลงทะเบียน)

### 1.2 ไฟล์เทสต์ใหม่ที่คาดว่าจะเกิดจาก PR A–E และที่ลงทะเบียน

| PR | ไฟล์ (คาดการณ์) | ลงทะเบียนที่ |
|---|---|---|
| A | `packages/contracts/src/line-external-browser.spec.ts` (`withLineExternalBrowserParam`) | `ci.yml:543` |
| A | `apps/api/src/modules/access-control/domain/logic/plan-manager.logic.spec.ts` (`planManagersOf`/`canManagePlan`) | catalog `:373+` |
| A | `apps/api/src/modules/line-ai/application/use-cases/line-locked-card-handoff.spec.ts` (R-B2 ทาง (ข): flag on/off, recorded==sent, group → plain) — หรือขยาย `process-line-webhook.use-case.spec.ts` (มีใน catalog `:387`) | catalog |
| A | ขยาย `line-liff-signup.spec.ts`, `line-first-signup-webhook.spec.ts`, `line-signup-notify.service.spec.ts`, `line-signup-status-and-package-change.spec.ts`, `plan-term-sweep.use-case.spec.ts`, `package-change-decision.use-case.spec.ts`, `line-billing-entry.spec.ts` (catalog `:371`) | เดิม |
| B | `packages/contracts/src/plan-term.spec.ts` (`planTermStateLabel`) | `ci.yml:543` |
| B | ขยาย `apps/api/src/modules/auth/auth.controller.spec.ts` (`/auth/me/companies` lockReason), web specs ของ picker/switcher/PartnerDetailPage/LoginPage | เดิม / auto |
| C | `apps/api/src/modules/billing/domain/billing-recipient-otp.logic.spec.ts`, `apps/api/src/modules/billing/application/billing-recipient-otp.service.spec.ts`, `billing-document-resend.spec.ts`, `billing-notifications-recipient.spec.ts` (ชื่อจริงตาม pr-c §6.3) | catalog `:373+` |
| C | `apps/api/src/modules/billing/billing-recipient-capture.pg.spec.ts` (คอลัมน์ใหม่ทุกตัว + apply → recipient captured + replay) | `ci.yml` ต่อจาก `:778` |
| C | `apps/api/src/scripts/billing-no-setup-smoke.ts` + selector `BILLING_NO_SETUP_ONLY` ใน `billing-http-smoke.ts` | `extended-tests.yml` step ใหม่ |
| C | แก้ smoke/spec ที่จะแดง: `billing-http-smoke.ts:267-295,310-346`, `email-verification-smoke.ts`, `billing-free-days-smoke.ts`, `billing-portal-smoke.ts`, `billing-notification-smoke.ts`, `billing-company-profile.spec.ts` (api+contracts ชื่อใน `ci.yml:543-544`), `billing-profile-recovery.spec.ts` (`:544`), `billing-email-recipient.postgres.spec.ts` | เดิม |
| D | `e2e/billing-no-setup.spec.ts` + `apps/web/src/features/billing/billing-no-setup.fixture.ts`; web specs `BillingPage*.spec.ts`, ขยาย `api-error-coverage.spec.ts` ให้ไล่ `billingError('X')` | `extended-tests.yml` step ใหม่ / auto |
| E | `apps/api/src/modules/billing/application/billing-document-admin.service.spec.ts`, `billing-admin-lookup.spec.ts`, `apps/api/src/modules/system-partner-management/application/use-cases/update-partner-identity.use-case.spec.ts`, `apps/api/src/modules/line-ai/application/use-cases/line-support-reference.spec.ts` | catalog `:373+` |
| E | `apps/api/src/modules/billing/billing-admin-tools.pg.spec.ts` | `ci.yml` ต่อจาก `:778` |
| E | `e2e/billing-admin-document-tools.spec.ts`; ขยาย `e2e/billing-admin-directory.spec.ts`, `e2e/system-support-resolution.spec.ts` | `extended-tests.yml` step ใหม่ |

### 1.3 แก้ตรงไหน (current → new)

**`scripts/line-ai-whole-chain-acceptance.catalog.mjs`** — suite `api-behavior` (`:342-347`), args array `:348-426`; แทรกต่อจาก `:373` (`'src/modules/billing/application/billing-approval.spec.ts',`):
```js
      // Purchase-without-setup (2026-09): not in apps/api/package.json's fixed list, so this runner executes them.
      'src/modules/access-control/domain/logic/plan-manager.logic.spec.ts',
      'src/modules/billing/domain/billing-recipient-otp.logic.spec.ts',
      'src/modules/billing/application/billing-recipient-otp.service.spec.ts',
      'src/modules/billing/application/billing-document-resend.spec.ts',
      'src/modules/billing/application/billing-notifications-recipient.spec.ts',
      'src/modules/billing/application/billing-document-admin.service.spec.ts',
      'src/modules/billing/application/billing-admin-lookup.spec.ts',
      'src/modules/system-partner-management/application/use-cases/update-partner-identity.use-case.spec.ts',
      'src/modules/line-ai/application/use-cases/line-support-reference.spec.ts',
```
(แต่ละ PR เพิ่มเฉพาะบรรทัดของตัวเอง; ห้ามใส่ชื่อไฟล์ที่ยังไม่มี — runner จะ fail)

**`.github/workflows/ci.yml:543`** current:
```
          pnpm exec tsx --test packages/contracts/src/company-business-type.spec.ts packages/contracts/src/billing-company-profile.spec.ts
```
new (PR A เพิ่ม `line-external-browser.spec.ts`, PR B เพิ่ม `plan-term.spec.ts`):
```
          pnpm exec tsx --test packages/contracts/src/company-business-type.spec.ts packages/contracts/src/billing-company-profile.spec.ts packages/contracts/src/line-external-browser.spec.ts packages/contracts/src/plan-term.spec.ts
```
`:544` ชื่อ `billing-company-profile.spec.ts` และ `billing-profile-recovery.spec.ts` — PR C แก้เนื้อหา spec ให้สอดคล้อง gate ใหม่ **ห้ามลบไฟล์** (ลบแล้ว step นี้พัง); `:545` `billing-profile-navigation.spec.ts` คงไว้ (§18.2 R-A9)

**`.github/workflows/ci.yml` PG** — แทรกต่อจาก `:778` (ใน step "Test Step 0 company tax identity against PostgreSQL", ใช้ DB เดียวกัน; migration ใหม่ถูก `migrate deploy` ที่ `:773` แล้ว):
```
          BILLING_RECIPIENT_TEST_DATABASE_URL="$DATABASE_URL" \
            pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-recipient-capture.pg.spec.ts
          BILLING_ADMIN_TOOLS_TEST_DATABASE_URL="$DATABASE_URL" \
            pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-admin-tools.pg.spec.ts
```
(spec ต้อง `skip` เมื่อ env ว่าง — pattern เดียวกับ `sales-console.pg.spec.ts`)

**`.github/workflows/extended-tests.yml`** (job `Billing Integration (${{ matrix.suite }})` `:187`; billing suites `:250-383`):
- smoke (PR C): ต่อจาก `:298` ใน step "Test signup and billing recovery…" (`matrix.suite == 'customer'`):
  ```
          BILLING_SIGNUP_JOURNEY_ONLY=0 BILLING_NO_SETUP_ONLY=1 BILLING_BROWSER_E2E=1 node apps/api/dist/apps/api/src/scripts/billing-http-smoke.js
  ```
- e2e (PR D และ PR E): step ใหม่ต่อจาก `:309` คัดลอกโครง `:299-309` ทั้ง env (`DATABASE_URL`, `REDIS_URL`, `API_PORT`, `WEB_PORT`, `LINE_LIFF_ID`, `NEXT_DIST_DIR`) เปลี่ยนพอร์ตไม่ให้ชน (เช่น `API_PORT: '3157'`, `WEB_PORT: '3158'`, `NEXT_DIST_DIR: .next/purchase-no-setup`, `DATABASE_URL: ...:5432/purchase_no_setup_test` ที่ต้องสร้างในขั้น "Prepare isolated billing databases" `:239-246`):
  ```
      - name: Test purchase-without-setup journeys in the browser
        if: matrix.suite == 'customer'
        timeout-minutes: 6
        env: { …ตาม :302-308 }
        run: pnpm exec playwright test e2e/billing-no-setup.spec.ts e2e/billing-admin-document-tools.spec.ts e2e/billing-admin-directory.spec.ts e2e/system-support-resolution.spec.ts --workers=1
  ```
- ทุกครั้งที่แก้ `extended-tests.yml`/`ci.yml` → ต้องขึ้น main แบบ byte-identical ก่อน UAT `all` (§3)

### 1.4 หลักฐาน PG/smoke/e2e (F27)
"CI ครั้งเดียวตอน merge" ให้แค่ unit/typecheck/boot; PG (นอกจาก 2 ไฟล์ที่ชื่อใน ci.yml) / smoke / e2e มาจาก **Extended Tests (workflow_dispatch)** เท่านั้น → ท้าย Phase 2 และ Phase 4 ต้อง dispatch `Extended Tests` บน branch ของ PR แล้วบันทึก run id ใน `docs/agent-memory/purchase-without-setup-2026-09-26.md` (Verification)

## 2. Pins (RV12, P0)

### 2.1 สถานะปัจจุบัน (รันจริง 2026-09-27 บน worktree develop ddcdcadf)
```
$ node infra/security/sync-production-maintenance-release-pins.mjs --check
Production maintenance enforcement pins are stale.
Run: node infra/security/sync-production-maintenance-release-pins.mjs
EXIT=1
```
→ develop stale อยู่แล้ว (commit 48c4ab57 แก้ `auth.guard.ts` โดยไม่ sync) → **PR A ต้องทำข้อ 2.2 เป็น commit แรก** มิฉะนั้น CI ทุก PR ที่ `code_changed` แดงที่ `ci.yml:318-324` ("Verify maintenance policy pins before CI fan-out": รัน `--check` เมื่อ `code_changed == true && validated_ci_run_id == ''`)

### 2.2 ขั้นตอน sync (ทำใน PR ที่แตะไฟล์ pinned หรือ PR แรก)
```bash
node infra/security/sync-production-maintenance-release-pins.mjs          # rewrite expected_* ใน infra/security/validate-production-maintenance-release.sh (:20-30…) และ EXPECTED_MAINTENANCE_RELEASE_VALIDATOR_SHA256 ใน .github/workflows/deploy-production.yml:421
node infra/security/sync-production-maintenance-release-pins.mjs --check  # ต้อง exit 0
bash infra/security/validate-production-maintenance-release.spec.sh
bash infra/security/sync-production-maintenance-release-pins.spec.sh
git add infra/security/validate-production-maintenance-release.sh .github/workflows/deploy-production.yml   # stage explicit paths เท่านั้น
```
commit ใน PR เดียวกัน + twin main; CI ตรวจซ้ำที่ `ci.yml:603-604` (Release Contracts ส่วน security รัน `.spec.sh` ทั้งสอง)

### 2.3 ไฟล์ pinned ที่แผนนี้เกี่ยว (validator `infra/security/validate-production-maintenance-release.sh:97-154`)
| ไฟล์ | บรรทัด validator | PR ที่แตะ | หมายเหตุ |
|---|---|---|---|
| `apps/api/src/modules/auth/presentation/auth.guard.ts` | `:106` (`expected_auth_guard` `:25`) | **PR C** (allowlist `recipient/otp/request|confirm`, `documents/:id/resend` ใน `isBillingRecoveryRoute` `:98-104`); PR A เฉพาะถ้า route LIFF/handoff ใหม่ต้องเข้า allowlist (ไม่คาดว่าต้อง) | sync pins ใน PR นั้น |
| `apps/api/src/modules/auth/auth.module.ts` | `:107` | ไม่มี (helper ของ PR A เป็นฟังก์ชัน Prisma ธรรมดา ไม่ใช่ provider) | หลีกเลี่ยง |
| `apps/api/src/modules/auth/application/email-access.service.ts` | `:108` | ไม่มี (R-B3 ถูกตัด) | หลีกเลี่ยง |
| `apps/api/src/modules/auth/application/use-cases/refresh-session.use-case.ts` | `:109` | **ห้าม** (DQ8 ทำที่ `issue-token.use-case.ts` เท่านั้น) | |
| `apps/web/app/login/page.tsx` / `apps/web/src/common/auth/session-gate.logic.ts` | `:112` / `:114` | **ห้าม** (R-B5 ทำใน `LoginPage.tsx`) | |
| `apps/web/app/(workspace)/companies/[companyId]/layout.tsx` | `:116` | **ห้าม** (G14 ทำใน `WorkspaceLayout.tsx`) | |
| `apps/workers/src/main.ts` | `:154` | **ห้าม** (drain ใหม่เข้า `/internal/billing/drain` เดิม) | |
| `infra/postmark/config.py` / `config.json` | `:131-132` | เฉพาะถ้า DQ6 เปลี่ยน stream (ดู §6) | sync pins |
| `packages/config/src/index.ts` | literal checks `:121-124` | **ห้ามเพิ่ม env** (D-PF-8) | |
ไม่ pinned: `billing-*.ts`, `liff-page.security.ts`, `line-handoff.logic.ts`, `schema.prisma` (มีแค่ literal check `:125-126`), `audit-action.ts` (literal `:129`), `.github/workflows/ci.yml`, `extended-tests.yml`

## 3. ci.yml parity กับ main ก่อน UAT `all` (F11, RV35)

- กลไก: `deploy-uat.yml:79-93` เทียบ blob `.github/workflows/ci.yml` ของ candidate (`SOURCE_SHA`) กับของ controller (`GITHUB_SHA` = main); ต่างกัน + target `all|auto` → **ERROR** (`:88-91`); ต่างกัน + target อื่น → รัน validation เต็ม; ขั้น acceptance `:782-785` เทียบซ้ำทั้ง `ci.yml` และ `deploy-uat.yml`; runbook `:273-277`
- ลำดับที่ต้องทำเมื่อมีการแก้ workflow (PR A: catalog ไม่ใช่ workflow — แต่ `ci.yml:543` และ PG/extended steps เป็น workflow):
  1. รวมการแก้ `ci.yml` + `extended-tests.yml` ของทุก PR ให้เป็น **PR workflow-only** (หรือให้ PR ที่แตะ workflow merge develop แล้ว twin main ทันที)
  2. merge develop → เปิด twin PR ไป main (admin-merge ตามมติ Owner) **ก่อน** dispatch UAT `all`
  3. candidate UAT = SHA บน develop ที่ blob `ci.yml` == main (ตรวจ: `git rev-parse <candidate>:.github/workflows/ci.yml` vs `git rev-parse origin/main:.github/workflows/ci.yml`)
  4. ระหว่าง READY→Production ห้ามแตะ main (runbook `:24-25`)
- การแก้ `.github/` ทำให้ job Release Contracts รัน (`ci.yml:305-313`, regex `:310`) — ปกติ

## 4. Migrations (RV13/A4)

- ที่: `apps/api/prisma/migrations/YYYYMMDDHHMMSS_snake_case/migration.sql`; ล่าสุดบน develop (2026-09-28) `20260927180000_line_document_qa_questions` → ชื่อใหม่ต้องเรียงหลัง; 2 ไฟล์ (ตัดสิน 2026-09-27, เปลี่ยนเวลา 2026-09-28 เพราะงาน AI ใช้ช่วง `20260927110000`–`20260927180000` ไปแล้ว): PR C `20260928200000_billing_recipient_columns` (BillingAccount 5 คอลัมน์ + index `recipientEmail` + `EmailVerificationToken.companyId` + index), PR E `20260928210000_line_support_request_reference` (2 คอลัมน์); ตอนลงมือถ้า develop มี migration ใหม่กว่านี้ ให้ขยับ timestamp ไปหลังตัวล่าสุด (คงชื่อท้ายเดิม) แล้วแก้ชื่อใน 00-readme, brief และ memory ใน PR เดียวกัน
- additive เท่านั้น: `ALTER TABLE … ADD COLUMN … NULL` / `CREATE INDEX` (ไม่ใช้ `CONCURRENTLY` — migration รันใน transaction); ห้าม `DROP/TRUNCATE/DELETE` — auto-promotion ปฏิเสธ (`apps/api/prisma/verify-applied-migration-catalog.ts:120-127` → `assertProductionA5NoDestructiveSql`)
- ไม่มี Prisma enum ใหม่: `BillingOperation.type` เป็น `String` (`schema.prisma:9859`), `LineSupportRequest` ใช้ string สำหรับ `closedReason/lastReplyDeliveryStatus` (`:4207-4212`); ค่าใหม่ (`RECIPIENT_ADMIN_CHANGE`, `CUSTOMER_PROFILE_SYNC`, `recipientSource`, `referenceKind`) เป็น string ใน union ของ contracts; **ถ้าประกาศ `as const` array ใน contracts ชื่อต้องไม่ตรงชื่อ Prisma enum** (`packages/contracts/src/prisma-enum-parity.spec.ts:284-309` จะ flag) — เช่น `BILLING_RECIPIENT_SOURCES` ไม่มี enum ชื่อ `BillingRecipientSource` จึงผ่าน
- CI: `ci.yml:754` `prisma:validate` → `:755` `migration:review` (SQL diff ให้ reviewer อ่าน) → `:773` fresh `migrate deploy` บน DB ว่าง → PG specs → `:781` `test:boot`; ไม่มีอะไรเทียบ migration กับ schema → **PG spec ของ PR นั้นต้องเขียน/อ่านคอลัมน์ใหม่ทุกตัว**
- ปล่อย: migration pending บน production → READY ต้องเดิน `APPEND_ONLY_PENDING` (fresh tagged snapshot → restore clone → rehearsal → cleanup; runbook `:359-360`) ไม่ใช่ `EXACT_MATCH` quick path; แก้ migration หลังออก Passport = เริ่ม UAT ใหม่ (`:25`)
- script backfill `recipientEmail` (PR C): อ่าน Stripe Customer อย่างเดียว เขียนคอลัมน์เมื่อว่าง; รันใน release step หลัง migrate (ระบุใน runbook ของ release; idempotent; log จำนวนแถว ไม่ log อีเมล)

## 5. Contracts build order / typecheck / DI / boot / Release Contracts

- ลำดับ: `pnpm --filter @watchdog-bms/contracts build` ก่อนทุกอย่าง (`ci.yml:446` typecheck job, `:504` unit, `:539` acceptance, `:756` migrations job) → `prisma generate` (`:447,:505,:757`); API typecheck อ่าน contracts จาก src (TS7 `apps/api/tsconfig.typecheck.json`) แต่ **web อ่าน `dist`** (`apps/web/tsconfig.typecheck.json:10` `"@watchdog-bms/contracts": ["../../packages/contracts/dist/index.js"]`) → local: build contracts ก่อน `pnpm --filter @watchdog-bms/web typecheck` เสมอ; CI ใช้ TS7 single-threaded (`:456-462`) — local ใช้ script `typecheck` ของ package (heap flag)
- DI metadata: `ci.yml:468-470` `node apps/api/scripts/check-di-metadata.mjs` — class `@Injectable()` ใหม่ (`BillingDocumentAdminService`, `UpdatePartnerIdentityUseCase`, service OTP ของ PR C) ต้องประกาศ constructor เอง (ห้ามสืบทอด constructor จาก base ที่ไม่มี decorator)
- boot: `ci.yml:781` `test:boot` (build + boot Nest) — provider ใหม่ต้องอยู่ใน `providers` ของ module (`billing.module.ts:29`, `system-partner-management.module.ts`), `CompanyIdentityUseCase` ต้อง `exports` ใน `data-model-core.module.ts:83-100`, `EmployeeAccessModule` เข้า imports ของ `SystemPartnerManagementModule` (`:49`); import วนตรวจด้วย boot
- Release Contracts (`ci.yml:305-313`, regex `:310`) รันเมื่อ PR แตะ: `.github/` (PR ที่แก้ workflow), `infra/` (PR A และ PR C จาก pins sync), `apps/web/public/` (PR A ถ้าเปลี่ยนภาพต้อนรับ — §18.2 R-C4 ให้ถอด/ไฟล์ชื่อใหม่), `packages/contracts/src/(legal-acceptance|line-ai).ts` (**ห้ามใส่ helper ใน `line-ai.ts`** — ถูกคัดลอกเข้า LINE AI release manifest), `packages/config/src/index.ts` (ห้ามแตะ), Dockerfile/prisma scripts (ไม่แตะ)
- body ใหม่ทุกตัวต้องเป็น class DTO (`apps/api/src/common/pipes/body-validation-coverage.spec.ts`; `forbidNonWhitelisted`)

## 6. Readbacks ก่อน UAT (RV18, DQ6, flags)

| รายการ | วิธีอ่าน | ค่าที่ต้องเป็น |
|---|---|---|
| `salesCompanyIds` ใน billing policy ที่ ACTIVE | `GET /v1/system/billing/settings` (`billing.controller.ts:279`, `system.billing.read`) → `policy.salesCompanyIds` หรือหน้า `/system/billing/settings`; กติกา `companyCanBuy` `billing-policy.ts:91-93`: `null` = ทุกร้านซื้อได้, รายการ = เฉพาะที่อยู่ในรายการ | **ต้องเป็น `null` บน UAT และ production** มิฉะนั้นร้านใหม่ทุกร้านติด `BILLING_COMPANY_SALES_CLOSED` (`:94-95`) แม้ทำ Phase 2 ครบ; ถ้าไม่ใช่ → Owner เผยแพร่ policy ใหม่ผ่าน configuration-changes (reviewed) ก่อน UAT |
| Postmark stream/secret (DQ6) | `infra/postmark/config.json` (pinned): uat/production `POSTMARK_MESSAGE_STREAM: "outbound"`, secrets `watchdog-bms/<env>/postmark/*`; runtime `POSTMARK_MESSAGE_STREAM` (`packages/config/src/index.ts:383` default `outbound`) ใช้ที่ `postmark.client.ts:58,80` | **ตัดสินแล้ว 2026-09-27 (spec §18.5 A1, DQ6):** คง stream `outbound` เดียว; แยก bounce ด้วย `intentKey 'billing-notice:<outboxId>'` + Tag `purpose` (ไม่มี env ใหม่, ไม่แตะไฟล์ pinned) |
| `LINE_WEB_HANDOFF_ENABLED` | `packages/config/src/index.ts:203` default `false`; ค่า UAT/production ไม่อยู่ใน git (`infra/kamal/config.json:3` มีแค่ `BILLING_MODE/STRIPE_ACCOUNT_ID` ฯลฯ) → อ่านจาก ECS task env ตาม runbook `cloud-environment-operations.md` / capture `infra/dev-kamal/capture-config.py` | ต้อง `true` ทั้ง UAT และ production (LIFF session `exchange-liff-session.use-case.ts:60` และการ mint ทุกเลนพึ่งค่านี้) |
| `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` | `index.ts:318` default `false`; production = `true` (ยืนยัน 2026-09-26 จาก capture ของ release — memory) | R-B2 ทาง (ข) ต้องผ่านทั้งสองค่า → UAT ทดสอบด้วยค่าเดียวกับ production (`true`) |
| `BILLING_MODE` | `infra/kamal/config.json:3` production `live`; UAT `test` | webhook `:2841` ต้องเป็น `test|live` จึงจะส่งลิงก์แพ็กเกจ |
| `POSTMARK_UAT_ALLOWED_RECIPIENTS` | secret `watchdog-bms/uat/postmark/POSTMARK_UAT_ALLOWED_RECIPIENTS` (`config.json` uat.secrets); `index.ts:386` | อีเมลที่ผู้ทดสอบจะพิมพ์ที่ Stripe Checkout บน UAT **ต้องอยู่ใน allowlist** มิฉะนั้นอีเมลชำระสำเร็จ/แจ้งผู้รับถูกปฏิเสธ (RV06) — เพิ่มอีเมลทดสอบก่อน (เปลี่ยน secret = ไม่แตะ git) |
| Stripe test mode บน UAT | `GET /v1/billing/catalog` (memory: pack 1999 live บน UAT) | catalog AVAILABLE; webhook secret ของ UAT ชี้ UAT |

## 7. UAT checklist (G27 ขยาย) และ production acceptance

### 7.1 UAT (Stripe test mode) — ทำตามลำดับ บันทึกผลทุกข้อ
| # | ขั้น | ผ่านเมื่อ |
|---|---|---|
| U1 | สร้างร้านใหม่จาก LINE จริง (iPhone) ผ่าน LIFF สมัคร; ไม่กรอกอีเมล/รหัสผ่าน | หน้าผลลัพธ์ LIFF = "เปิดร้านแล้ว ขั้นต่อไปเลือกแพ็กเกจ"; push = หัวข้อ "เปิดร้านแล้ว" ปุ่ม "เลือกแพ็กเกจ" (2 แตะ) |
| U2 | แตะ "เลือกแพ็กเกจ" จากหน้าผลลัพธ์ LIFF | Safari เปิดหน้าแพ็กเกจ ล็อกอินแล้ว **1 แตะ** ไม่มีหน้าล็อกอิน (AC10 ก) |
| U3 | พิมพ์ข้อความในแชต → การ์ดล็อก → แตะ | 1 แตะ, URL มี `openExternalBrowser=1`, `/l/<token>` ถูกใช้ (`usedAt`) และ preview ของ LINE ไม่เผา token (link preview) |
| U4 | ซื้อ STARTER รายเดือน **บัตร** (4242…) — Checkout ถามอีเมล+ที่อยู่ (Customer ไม่มีอีเมล) | กลับ return → PAID → APPLIED ≤ 3 นาที; `BillingAccount.recipientEmail` = อีเมลที่พิมพ์, `recipientSource = STRIPE_CHECKOUT`, `checkoutAddressJson` มีค่า; Stripe Customer.email/address ถูกบันทึก; ข้อมูลบริษัท (`Company.addressJson`) **ไม่ถูกเขียน** |
| U5 | ร้านใหม่ที่สอง (Android/Chrome) ซื้อด้วย **PromptPay** (test mode simulate) ข้ามแอปธนาคาร | return รอผลจนถึง APPLIED; locked shell ปลดในที่ (G14) |
| U6 | ร้านที่โปรไฟล์มีที่อยู่ครบ ซื้อซ้ำ | Checkout prefill ที่อยู่, `customer_update.address='never'` ไม่ทับที่อยู่ที่ sync; โปรไฟล์ไม่ครบ → `'auto'` |
| U7 | PROMPTPAY_RENEW กับอีเมลจาก Checkout (RV20) | binding สำเร็จ ไม่ค้าง attempt |
| U8 | อีเมลชำระสำเร็จ (Postmark UAT allowlist) | ถึงผู้รับ; ลิงก์เป็นหน้าเอกสารในแอป ไม่ใช่ Stripe |
| U9 | เปลี่ยนผู้รับด้วย OTP ไปอีเมลใหม่ (allowlist) จากหน้า return | op COMPLETED; Customer.email เปลี่ยน; ผู้รับเดิมได้อีเมลแจ้ง; LINE push ถึงผู้จัดการแพ็กเกจ |
| U10 | ส่งเอกสารซ้ำ (ลูกค้า) | Stripe event `invoice.sent` ปรากฏ (test mode ไม่ส่งอีเมลจริง); limiter 3/วัน; `receipt_email` เปลี่ยนแล้ว charge อัปเดต |
| U11 | จำลอง bounce (Postmark test webhook → intentKey `billing-notice:*`) | `recipientBouncedAt` ตั้ง, แบนเนอร์บนหน้าแพ็กเกจ, LINE push 1 ครั้ง; เปลี่ยนผู้รับแล้วธงล้าง |
| U12 | แอดมิน: ส่งซ้ำ + เปลี่ยนผู้รับ (self-confirm) จากหน้าใบ; ค้นด้วยเลข 8 ตัว; คำขอ "ให้ทีมงานติดต่อกลับ" จากการ์ดล็อกมีปุ่ม "เปิดรายการ" | ทุกข้อทำได้จากหน้าเดียว; audit ไม่มีอีเมล |
| U13 | แอดมินแก้ข้อมูลจดทะเบียนของร้านล็อก | บันทึกได้; op `CUSTOMER_PROFILE_SYNC` SUCCEEDED; Stripe Customer name/address ตรง; ใบเดิมไม่เปลี่ยน |
| U14 | รอเกิน 15 นาที แตะการ์ดเดิม (AC10 ข) / ลบ cookie แล้วแตะ (AC10 ค) / ลิงก์ในกลุ่ม (AC10 ง) | เข้าหน้าแพ็กเกจโดยไม่มีฟอร์มรหัสผ่าน; ลิงก์กลุ่มเป็น URL ธรรมดา |
| U15 | Extended Tests run ids (Phase 2 + Phase 4) | บันทึกใน memory |

### 7.2 Production acceptance (ภายใน ~5 นาทีหลัง website-ready — บทเรียน 2026-09-23)
1. Owner สร้างร้านใหม่จริงจาก LINE (iPhone และ Android อย่างละเครื่อง) → AC1 + AC10 (ก)(ข)(ค) → ซื้อ STARTER รายเดือนจริง (บัตร) → APPLIED → อีเมลชำระสำเร็จถึงจริง + ใบเสร็จ Stripe
2. เปลี่ยนผู้รับ (OTP ไปอีเมลจริงที่สอง) → ส่งเอกสารซ้ำ → **อีเมลจริงถึง** (พิสูจน์สิ่งที่ test mode ทำไม่ได้)
3. แอดมิน: เปลี่ยนผู้รับกลับ (reviewed op self-confirm) + ส่งซ้ำ; ค้นด้วยเลขอ้างอิงจากอีเมล
4. คืนเงิน/ยุติแพ็กเกจในแอป (flow เดิม; memory production-go-live) → ร้านกลับเป็นล็อก `trial_ended` และการ์ดล็อกยังเป็น one-tap
5. บันทึกตาม runbook (UAT/READY/Production run ids, signed result, customer `OPEN`)

### 7.3 แก้ rig e2e (RV31) — PR B หรือ PR D (ใครแตะ `e2e/plan-term-billing-readiness.spec.ts` ก่อน)
- `e2e/plan-term-billing-readiness.spec.ts:103-110` ส่ง `data: { days: 30 }` แต่ `RenewPlanTermBodyDto` (`partner.controller.ts:188-190` extends `PlanTermAdjustmentBodyDto` `:172-176`) บังคับ `commandId` (16–120 ตัว), `expectedVersion` (64 hex = `planTermSourceVersion`), `reason` — `checkPlanTermAdjustment` (`plan-term-adjustment.ts:29-34,47`) ตอบ 422 `partner_plan_term_command_required`/`partner_plan_term_changed` → BR01/02/07, GW02, BC03 ล้ม. new:
  ```ts
  const view = await (await request.get(`${urls.api}/system/partners/${companyId}/plan-term`, { headers: apiHeaders(adminToken, adminMembership.companyId) })).json() as CompanyPlanTermViewDto; // sourceVersion (contracts plan-term.ts:43)
  const res = await request.post(renewUrl, { headers: { ...apiHeaders(adminToken, adminMembership.companyId), 'X-Request-Id': requestId },
    data: { commandId: requestId, expectedVersion: view.sourceVersion, reason: 'e2e simulated payment', days: 30 } });
  ```
  (ใช้กับ `ownerRenew` `:116` ด้วย)
- BC03 `:736-776`: หลัง PR B ปุ่ม "ต่ออายุ" ในหน้า partner ต้องกรอกเหตุผล (`PartnerDetailPage.tsx:2489-2495` `handleRenew` ปฏิเสธเมื่อไม่มี `renewReason`) และร้าน `no_package` มีคำเตือนเพิ่ม → เพิ่มขั้น fill "เหตุผล" + จำนวนวันใน dialog ก่อน `:755`; label หัวข้อ `:750` "แพ็กเกจหมดอายุแล้ว" อาจเปลี่ยนเป็น label จาก `planTermStateLabel` (PR B) → อัปเดตตาม
- e2e นี้ไม่อยู่ใน workflow ใด → ใส่ใน step e2e ใหม่ของ §1.3 ถ้าเวลาพอ (ยาว ~10 นาที) หรือรัน local ครั้งเดียวก่อน UAT แล้วบันทึกผล

## 8. Docs amendment master table (รวม spec §17/§18 + ตาราง audit; ทุกบรรทัดตรวจแล้ว)

| ไฟล์:บรรทัด | เนื้อหาปัจจุบัน (สรุป) | ต้องแก้เป็น | PR |
|---|---|---|---|
| `docs/specs/billing-company-profile-gate-spec-th.md:5-13` | gate ที่อยู่ก่อนซื้อ, modal, sync Customer ก่อน Checkout | หัวไฟล์: "SUPERSEDED for purchases by purchase-without-setup D-PF-1 (2026-09-27)"; :5 ไม่บังคับก่อนซื้อ; :7-9 modal/กล่องเหลืองถอด; :10-11 sync Customer ตาม R-A2 (ที่อยู่เฉพาะครบ, อีเมลเฉพาะ verified/ผู้รับ); :13 quote ไม่มี profile ใช้ได้ | C (+D สำหรับ :7-9) |
| `docs/specs/signup-optional-email-otp-billing-spec-th.md:20,21,82,86,181-182,189,355` (คง :121-122) | verified email ก่อนจ่าย, D01 recipient = account email, copy LIFF "ยืนยันอีเมลก่อนชำระ", ตาราง gate, portal recheck email | :20-21 ผู้รับ = Stripe Customer email (`BillingAccount.recipientEmail`), OTP ผู้รับแยก purpose `billing_recipient`; :82/:86 copy ใหม่ (RV33); :181-182 ตัดเงื่อนไข verified email (คง pending-op check); :189 `billingEmail` optional; :355 portal ไม่ต้อง verified (DQ2) | C (copy :82 → A) |
| `docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md:51,53,75,112,120,152,155,184,194,350` | J2 "กรอกที่ขาด", R14 push ถึง OWNER, quote ดีลต้องอีเมล/ที่อยู่ (D4), S16, S19 ownerLineUserIds, D4, D-P3-8 billingProfileHref | :51/:53 ไม่กรอกในแอป; :75/:155 ผู้รับ push = plan managers (R-C11) ยกเว้น support reply คง `ownerLineUserIds`; :112/:184/:194/:350 D4 ถูกทับโดย D-PF-1; :152 S16 ปิด; :120 label ล็อกจาก lockReason | A (:75,:155) / C (:112,:152,:184,:194,:350) / D (:51,:53,:120) |
| `docs/plans/mangmee-sales-deals-and-locked-signup-plan-th.md:19,83` (RV34) | "ห้ามแตะ 6 ไฟล์" รวม `billing-collection.ts`, `billing-schedule.ts`, `billing-upgrade.ts`, `billing-refund-source.ts` | narrow เป็น "ห้ามแตะเฉพาะไฟล์หลักฐาน 2 ไฟล์ `paid-invoice.ts`, `paid-checkout-invoice.ts` (2026-09-27: purchase-without-setup แก้ `billing-collection.ts` DQ2; `billing-schedule.ts` ยังไม่แตะ)" ทั้งสองบรรทัด | C |
| `docs/specs/mangmee-company-plan-term-spec-th.md:70,72,93,113` (คง :3) | แจ้ง OWNER เท่านั้น; label "หมดอายุ"; แบนเนอร์เฉพาะ OWNER; LINE ตอบเฉพาะ OWNER | ผู้รับ = ผู้มี `company.plan.manage` (D-PF-10); label จาก `lockReason` ("ยังไม่มีแพ็กเกจ"/"หมดอายุ") | A (:70,:113) / B (:72,:93) |
| `docs/specs/mangmee-line-first-signup-spec-th.md:100,159,165,184-185,263` (คง :85) | ปุ่ม "เปิดร้านใหม่ ทดลองฟรี", push "พร้อมใช้แล้ว"+"เริ่มใช้งาน", target แดชบอร์ด, หมดอายุ 30 วัน/จ่ายมือ, copy "ทดลองฟรี 30 วัน" | :100 ตัด "ทดลองฟรี"; :159/:263 push "เปิดร้านแล้ว" + "เลือกแพ็กเกจ" (ยังเป็นลิงก์ LIFF — LINE-ONBOARD-01 :85 คง); :165 target ร้านล็อก = หน้าแพ็กเกจ (R-C3); :184-185 ไม่มีทดลอง/จ่ายมือ → ซื้อเอง | A |
| `docs/specs/mangmee-line-web-billing-ui-spec-th.md:71,73,75,78,165` (คง :200) | LIFF URL generic/no bearer in chat, purpose billing, mint at use, ไม่ต้องยืนยันอีเมล, polling 2 นาที | :71/:75 §2.2.1 เพิ่มข้อยกเว้น: การ์ดล็อก/ตอบขอเปลี่ยนแพ็กเกจ/โปรโมชั่น mint ในเลนก่อนบันทึก (ไม่ใน กลุ่ม; payload บันทึก = ส่ง); :73 destination permission-aware; :78 ยืนยันว่าไม่ต้องอีเมล/ที่อยู่; :165 polling 3 นาที (G13) | A (:71,:73,:75) / C (:78) / D (:165) |
| `docs/specs/line-web-deeplink-handoff-spec.md:5,224` | billing link เป็น LIFF generic; G7 link preview "not observed" | :5 อ้าง §2.2.1 ใหม่; :224 บันทึกผลตรวจ preview จริงจาก U3 | A (:5) / Phase 6 (:224) |
| `docs/research/line-stripe-browser-payment-reference-th.md:15` | external browser เป็นทางหลัก (decision) | เพิ่ม "ทำแล้ว 2026-09: `openExternalBrowser=1` ที่ทางออกข้อความ 3 จุด" | A |
| `docs/specs/mangmee-billing-subscription-spec-th.md:124,131,254` | apply/invoice.paid/operator resend ผ่าน Stripe | :124 เพิ่ม recipient capture หลัง apply; :131 คง; :254 ระบุปุ่มส่งซ้ำ (ลูกค้า/แอดมิน) | C (:124,:254) / E (:254 admin) |
| `docs/specs/mangmee-transactional-email-provider-spec-th.md:128,129` | Stripe customer emails, operator resend | :128 เพิ่มอีเมลชำระสำเร็จของเรา (Postmark) + bounce ผ่าน intentKey; :129 ปุ่มส่งซ้ำ | C / E |
| `docs/research/stripe-developer-reference-th.md:147-148` | Stripe ส่ง billing email; lost email → operator resend | อ้าง `invoices/:id/send` + `receipt_email` และข้อจำกัด test mode | C |
| `docs/specs/mangmee-owned-billing-integration-spec-th.md:76` | out-of-band invoice ต้องเข้ากติกา B01/B08 | เพิ่ม: runbook แก้เอกสารด้วยมือ (E §7) ออกใบ out-of-band ที่ระบบไม่ import | E |
| `docs/specs/company-plan-management-delegation-spec-th.md:48` | billing ไม่แก้ legal identity | + note เส้นทางแอดมิน (E §7) | E |
| `docs/specs/company-tax-identity-setup-spec.md:59,86-97,103,380-388,467` | อ้างอิงกติกา identity | :380-386 เพิ่มแถว partner console; :96 หมายเหตุ; อื่นคง (อ้างอิง) | E |
| `docs/specs/mangmee-billing-controls-spec-th.md:113,223` | keys / C08 commands | E §7 | E |
| `docs/specs/billing-single-admin-spec-2026-09-16.md:14` | flows | E §7 | E |
| `docs/specs/line-support-request-spec-th.md:15` (+§2.3 :237-243) | ไม่มีเลขอ้างอิงถึงลูกค้า | E §7 | E |
| `docs/runbooks/line-first-signup-support-playbook.md:56` | "แพ็กเกจหมดอายุแล้ว → กด ต่ออายุ" | เพิ่ม: ร้าน "ยังไม่มีแพ็กเกจ" ให้ลูกค้าซื้อเองจากหน้าแพ็กเกจ; "ต่ออายุ" = ให้วันฟรี (R-C6 คำเตือน) | B |
| `packages/contracts/src/external-signup.ts:372` | comment "Only ACTIVE is a valid RETURN_EXISTING target and direct entry." | คง `canEnter`; เพิ่ม comment ว่า `lockReason/canManagePlan` ใช้แสดงผลเท่านั้น | A |
| `docs/runbooks/line-rich-menu-v2-console-setup.md` | — | ไม่เปลี่ยน (ยืนยันแล้ว) | — |
| `docs/plans/mangmee-master-plan-index-th.md:44` (แถว PF, ยัง uncommitted) | "**DRAFT 2026-09-26** — มติ Owner D-PF-1..8 ครบ; รอรีวิว Q1–Q6 แล้วเริ่ม Phase 1" | "**DRAFT v0.2 2026-09-27** — D-PF-1..10; §18 ผลตรวจโค้ด; briefs ใน `docs/plans/purchase-without-setup/`; รอ DQ1–DQ8 แล้วเริ่ม PR A" แล้วอัปเดตสถานะทุกครั้งที่ PR merge | spec PR (ก่อน A) |
| `docs/plans/mangmee-purchase-without-setup-plan-th.md` / `docs/agent-memory/purchase-without-setup-2026-09-26.md` | — | ทุก PR: Status/Verification/Next + run ids | ทุก PR |

## 9. Release plan

- **ลำดับ PR:** A (API/LIFF/LINE + pins sync) → B (web/console) → C (billing API/schema/OTP/resend/R-A5) → D (web billing + Phase 5 polish) → E (admin) ; แต่ละ PR: worktree แยกจาก `origin/develop` ล่าสุด → develop → twin main (admin-merge) ; workflow edits ตาม §3
- **ปล่อยเดี่ยวได้ (RV35):** A ได้ (ไม่มี schema; R-B2/R-C2/R-C4 พึ่งแค่ flags เดิม); B ได้หลัง A (DTO optional); **C+D ต้องปล่อยคู่กัน** (P2 ข้อ 5: ถอด gate โดยไม่มี flow OTP ผู้รับ = อีเมลผิดแก้เองไม่ได้; และ web ยังส่ง `billingEmail ''` → ต้องแก้พร้อมกัน RV05); **E หลัง C เท่านั้น** (R-A5 — pr-e §1.7) และหลัง B (helper label)
- **Deploy notes:** (1) RV17 — `billing-repeat.ts:289-295` params เปลี่ยน (`customer_update`) และถูก hash ลง journal → deploy C เมื่อ **ไม่มี repeat attempt ค้าง** (`BillingAttempt` ที่ `quoteSnapshot.repeat` และ `status ∈ {CREATING, REQUESTING, OPEN}`) มิฉะนั้น attempt นั้นตก review — อ่านก่อน dispatch UAT/prod; (2) R-A5 + admin recipient change ต้องอยู่ release เดียว (pr-e §1.7); (3) backfill `recipientEmail` (PR C script) รันหลัง migrate ในขั้น release; (4) Postmark allowlist UAT + `salesCompanyIds` readback ก่อน UAT (§6); (5) migration pending → READY `APPEND_ONLY_PENDING` (§4); (6) production acceptance ภายใน ~5 นาที (§7.2)
- **Rollback:** migrations additive → image เก่าอ่านตารางเดิมได้ (คอลัมน์ใหม่ nullable ถูกละเลย); ไม่มี flag → rollback = promote image ก่อนหน้าตาม runbook; op ชนิดใหม่ (`RECIPIENT_ADMIN_CHANGE`, `CUSTOMER_PROFILE_SYNC`) ไม่อยู่ใน slot ของบัญชี → drain รุ่นเก่ามองข้าม (refund drain กรอง `type==='REFUND'` `billing-refunds.service.ts:186-187`; reconciler ดูเฉพาะ slot `:214-229`) จึงไม่ค้างระบบ แต่แถว QUEUED จะรอจน redeploy; `recipientSource='ADMIN'`/`STRIPE_CHECKOUT` ที่เขียนไว้ไม่มีผลกับโค้ดเก่า (ยังใช้ Customer.email); **ข้อยกเว้น:** ถ้า rollback หลังลูกค้าเปลี่ยนผู้รับด้วย OTP ใหม่ (Customer.email ≠ account email) โค้ดเก่าจะโยน `BILLING_RECIPIENT_UPDATE_REQUIRED` กับร้านนั้นจนกว่าจะ redeploy — บันทึกในแผน rollback ว่าต้องแก้ Customer.email กลับใน Stripe Dashboard ต่อร้านที่ได้รับผลกระทบ (นับจาก audit `billing.recipient.changed`)

## ต้องตรวจ

1. ชื่อไฟล์เทสต์จริงจาก brief PR A–D (ตาราง §1.2 เป็นชื่อคาดการณ์) — ผู้ implement PR นั้นเป็นคนใส่ชื่อจริงลง catalog/ci.yml/extended-tests ใน PR ของตัวเอง; ห้ามอ้างไฟล์ที่ยังไม่มี
2. ตัดสินแล้ว (spec §18.5 DQ6): stream เดียว + intentKey
3. RV18: อ่าน `salesCompanyIds` จริงบน UAT และ production ก่อน UAT (ยังไม่รู้ค่า)
4. ค่า `LINE_WEB_HANDOFF_ENABLED` บน UAT/production (ไม่อยู่ใน git) — อ่านจาก task env ตาม runbook cloud-environment-operations
5. หลัง PR B: ตรวจ BC03 (`:736-776`) กับ dialog ต่ออายุที่ต้องกรอกเหตุผล/คำเตือน no_package แล้วแก้ขั้นตอนใน spec ตาม §7.3
6. พอร์ต/DB ใน step e2e ใหม่ของ `extended-tests.yml` ต้องไม่ชนกับ step อื่นใน job `customer` (`:299-309` ใช้ 3153/3154, `email_otp_test`)
7. `git rev-parse <candidate>:.github/workflows/ci.yml == origin/main` ก่อน dispatch UAT `all` ทุกครั้ง (รวม `deploy-uat.yml` `:783-785`)
8. `e2e/client-support.spec.ts` ถูกอ้างในคำสั่งงานว่าเกี่ยวกับ support — ตรวจแล้วเป็นเรื่อง client compatibility notice (`:6-48`) ไม่ต้องแก้; e2e support ที่เกี่ยวคือ `system-support-resolution.spec.ts`
