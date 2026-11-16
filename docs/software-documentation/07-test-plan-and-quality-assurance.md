# 07 — แผนการทดสอบและบันทึกการประกันคุณภาพ (Test Plan & QA Record)

**วัตถุประสงค์:** เอกสารนี้บันทึกวิธีทดสอบที่ทีม MangmeePlus / WatchDog-BMS ใช้จริงจนถึงวันปิดโครงการ (2026-11-16): ระดับการทดสอบ, รายการไฟล์ทดสอบทั้งหมดใน repo, สภาพแวดล้อมและข้อมูลทดสอบ, คำสั่งที่ใช้รันแต่ละชุด, quality gate และนิยามของ "เสร็จ", ผลการวัดคุณภาพ AI ที่บันทึกไว้, และข้อบกพร่องที่ยังเปิดอยู่ตอนปิด ทีมใหม่ต้องสามารถรันชุดทดสอบเดิมซ้ำและรู้ว่าชุดใดเชื่อได้แค่ไหนจากเอกสารนี้กับโค้ดที่ archive ไว้

**ที่มา:** checkout `closeout-docs-main` = `origin/main` commit `08850deaf` (2026-11-10) ตัวเลขจำนวนไฟล์ทุกตัวนับจาก `git ls-files` ของ commit นี้ ไม่ได้รันชุดทดสอบใดระหว่างเขียนเอกสาร (ข้อห้ามของ brief) ผลทดสอบที่อ้างจึงเป็นผลที่ **บันทึกไว้ในเอกสารของ repo** พร้อมวันที่ ไม่ใช่ผลรันใหม่

**รหัสพื้นที่ requirement ที่ใช้เชื่อมกับเอกสารอื่น:** CORE (ตัวตน/สิทธิ์/บริษัท/สาขา/แพลตฟอร์ม), EXP (รายจ่าย/ใบเบิก/ใบรับรองแทนใบเสร็จ/ใบสำคัญจ่าย), TAX (ภาษีหัก ณ ที่จ่าย/ภ.ง.ด./VAT), CRM (ลูกค้า/LINE OA ของร้าน/inbox), LINE (LINE AI "น้องมั่งมี"/สมัครผ่าน LINE), BILL (แพ็กเกจ/Stripe/ทีมขาย/ลิงก์ demo)

## สารบัญ

1. [กลยุทธ์และระดับการทดสอบที่ใช้จริง](#1-กลยุทธ์และระดับการทดสอบที่ใช้จริง)
2. [รายการทดสอบทั้งหมด (inventory)](#2-รายการทดสอบทั้งหมด-inventory)
3. [สภาพแวดล้อมและข้อมูลทดสอบ](#3-สภาพแวดล้อมและข้อมูลทดสอบ)
4. [วิธีรันแต่ละชุด, ชุดที่ไม่นิ่ง, และ CI workflow](#4-วิธีรันแต่ละชุด-ชุดที่ไม่นิ่ง-และ-ci-workflow)
5. [Quality gate, review checklist, นิยามของเสร็จ และหลักฐาน](#5-quality-gate-review-checklist-นิยามของเสร็จ-และหลักฐาน)
6. [ผลคุณภาพ AI ที่บันทึกไว้](#6-ผลคุณภาพ-ai-ที่บันทึกไว้)
7. [ข้อบกพร่องและเรื่องค้างที่บันทึกไว้ตอนปิด](#7-ข้อบกพร่องและเรื่องค้างที่บันทึกไว้ตอนปิด)
8. [ข้อกำหนดเชิงคุณภาพ (NFR) ที่เอกสารนี้นิยาม](#8-ข้อกำหนดเชิงคุณภาพ-nfr-ที่เอกสารนี้นิยาม)
9. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#9-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)
10. [ภาคผนวก ก — รายชื่อไฟล์ทดสอบทุกไฟล์](#ภาคผนวก-ก--รายชื่อไฟล์ทดสอบทุกไฟล์)

---

## 1. กลยุทธ์และระดับการทดสอบที่ใช้จริง

หลักที่ทีมยึด (จาก `AGENTS.md` และ `docs/runbooks/local-proof-stack-and-merge-gate.md`): ทุกการแก้ที่ไม่ใช่เรื่องเล็กต้องมี "การตรวจที่รันได้อย่างน้อยหนึ่งอย่าง", ข้อบกพร่องที่พบจากการกดหน้าจอจริงต้องได้ assertion ใน journey test ไม่ใช่แค่ unit test, และหลัง merge ทุกครั้งต้องผ่าน merge gate ในเครื่องก่อนเจ้าของได้ลอง ตั้งแต่ 2026-10-20 GitHub Actions ถูกปิดตามคำสั่งเจ้าของ (`docs/plans/ops-followups-2026-10-23-plan.md` บรรทัด 20) การตรวจทั้งหมดจึงรันในเครื่องผู้พัฒนา ส่วน workflow ใน `.github/workflows` ยังอยู่ใน repo ในฐานะนิยามของ gate ชุดเดิม

| ระดับ | เครื่องมือ | ที่อยู่ | ลักษณะ |
|---|---|---|---|
| Unit / spec | `node:test` ผ่าน `tsx --test` (ไม่มี Jest/Vitest) | `apps/*/src/**/*.spec.ts`, `packages/*/src/*.spec.ts`/`*.test.ts` | ทดสอบ domain logic, use case, DTO, controller ด้วย fake/in-memory port |
| Spec กับ PostgreSQL จริง | `tsx --test` + ฐานข้อมูล local | `*.pg.spec.ts`, `*.postgres.spec.ts` (89 ไฟล์) | ตรวจ constraint, race, migration, repository; ต้องมี `DATABASE_URL`/`BILLING_TEST_DATABASE_URL` ชี้ localhost (`apps/api/src/common/database/pg-spec-guard.ts`) |
| Boot / DI smoke | `apps/api/src/scripts/boot-di-smoke.ts`, `apps/api/scripts/check-di-metadata.mjs` | — | ยืนยันว่า NestJS ประกอบ dependency ได้จาก build `swc` จริง |
| Contract test | `tsx --test` | `packages/contracts/src/*.spec.ts`, `apps/api/src/modules/line-ai/**/agent-tools.parity`, `prisma-enum-parity.spec.ts` | ยืนยันว่า type/enum/entitlement/permission ที่ API, web, gateway ใช้ร่วมกันตรงกัน |
| Whole-chain acceptance (LINE AI) | `scripts/run-line-ai-whole-chain-acceptance.mjs` + catalog | `scripts/line-ai-whole-chain-acceptance.catalog.mjs` | 52 scenario (`LINE_AI_WHOLE_CHAIN_SCENARIOS`) ที่ไล่ทั้งสาย webhook → intake → gateway → tool → การ์ดตอบ; รันผ่าน 6 suite (`reliability-gateway-v2`, `reliability-api-v2`, `reliability-web-v2`, `reliability-contracts-evaluation-v2`, `api-behavior`, `gateway-behavior`) และ 2 suite PostgreSQL (`eval-guard-postgres`, `reliability-postgres-v2`) ที่ระบุชื่อไฟล์ spec |
| Golden / corpus | `pnpm test:harness` | `scripts/*.golden.spec.ts`, `scripts/*.corpus.spec.ts`, `scripts/*.fixtures.spec.ts` | ล็อกชุดคำถาม/หมวดรายจ่าย/ผลอ่านเอกสารที่ตกลงกันไว้ |
| AI evaluation harness (เรียกโมเดลจริง) | `scripts/line-ai-expense-advisor/*`, `scripts/run-line-ai-*.ts` | ดูหัวข้อ 6 | วัดอัตราผ่าน, เวลา, ต้นทุนต่อ turn; ไม่อยู่ใน gate ปกติเพราะมีค่าใช้จ่าย |
| HTTP smoke | `tsx` script ต่อ API ที่ build แล้ว | `apps/api/src/scripts/*smoke*.ts` (66 ไฟล์) | ยิง HTTP จริงกับ API + PostgreSQL แยก + provider จำลอง; ส่วนใหญ่เป็น billing |
| E2E (Playwright) | `@playwright/test` | `e2e/*.spec.ts` (71 ไฟล์) | เปิด API + web จริงจาก source ผ่าน `playwright.config.ts` |
| Journey test | Playwright project `journeys-mobile` | `e2e/journeys/*.journey.spec.ts` (20 ไฟล์) | เดินเส้นทางเหมือนคนใช้ บนจอ 375×667 และจบด้วยการอ่าน record จาก server |
| Responsive / visual evidence | Playwright project `mobile-chromium`, `iphone13-webkit`, `iphone13-chromium`, `mobile-375`, `desktop-1280/1440/1920` | `e2e/responsive.spec.ts`, `e2e/evidence.spec.ts`, `e2e/responsive-baseline.spec.ts` | ตรวจว่าไม่มีส่วนใดล้นจอ, เป้ากดมีขนาดพอ, ถ่ายภาพหลักฐาน |
| Accessibility | Playwright + unit | `e2e/feature-entitlement-accessibility.spec.ts`, `apps/api/src/common/security/liff-page-contrast.spec.ts`, `scripts/qa/action-loading-coverage.mjs` | ตรวจ fallback ที่อ่านได้, contrast ของหน้า LIFF, ปุ่มทุกปุ่มมีสถานะ loading |
| Security check | spec + shell spec | `apps/api/src/common/security/*.spec.ts` (10 ไฟล์), `apps/api/src/common/security/line-package-advisor.check.ts`, `e2e/liff-xss.spec.ts`, `infra/**/*.spec.sh`, `pnpm security:audit` | rate limit, เปรียบเทียบ secret แบบ constant-time, trusted client IP, worker token, XSS บน LIFF, นโยบาย image |
| Infra / release controller test | `python3` unittest, `bash *.spec.sh`, `node --test` | `infra/**/*_test.py` + `*.spec.sh` (81 ไฟล์), `infra/**/*.spec.{mjs,cjs}` (3 ไฟล์) | ทดสอบตัวควบคุม release, alarm, policy IAM ด้วย AWS ปลอม ไม่แตะ cloud |
| Load smoke | k6 | `scripts/load-smoke.k6.js` | เส้นทาง login → dashboard → รายการรายจ่าย → เริ่มอัปโหลดใบเสร็จ |
| Manual UAT | เจ้าของ/ผู้ทดสอบกดจริงบน UAT และ production | `docs/qa/*`, `e2e/TEST-CASES.md` | ดูหัวข้อ 5.4 |

### 1.1 การลงทะเบียนไฟล์ spec — CI รันเฉพาะไฟล์ที่ถูกระบุชื่อ

`apps/api`, `apps/ai-gateway`, `apps/workers`, `packages/contracts` **ไม่ใช้ glob** สคริปต์ `test` ใน `package.json` ของแต่ละแพ็กเกจเป็นรายการ path ที่ดูแลด้วยมือ ไฟล์ spec ใหม่จะรันก็ต่อเมื่อมีสคริปต์ใดสคริปต์หนึ่งระบุชื่อ (มีเพียง `apps/web` ที่ใช้ glob `tsx --test "src/**/*.spec.ts"`)

- ตัวบังคับของ API: `apps/api/src/spec-suite-coverage.spec.ts` ล้มเมื่อมี `*.spec.ts` ใต้ `apps/api/src` ที่ไม่ถูกอ้างในสคริปต์ `--test` ของ `apps/api/package.json`, ใน `scripts/line-ai-whole-chain-acceptance.catalog.mjs`, ใน `.github/workflows/ci.yml` หรือ `.github/workflows/extended-tests.yml` ยกเว้น `*.pg.spec.ts` (ต้องมีฐานข้อมูล) และรายการ `KNOWN_FAILING` (ดูหัวข้อ 7)
- แพ็กเกจอื่น **ไม่มี** ตัวบังคับแบบเดียวกัน ตัวเลขด้านล่างจึงแสดงไฟล์ที่ไม่มีสคริปต์ `package.json` ระบุชื่อ บางไฟล์รันผ่าน whole-chain catalog แทน (ตรวจด้วยการค้นชื่อไฟล์ใน catalog และ workflow สองไฟล์; ชื่อไฟล์ที่ซ้ำกันข้ามแพ็กเกจอาจทำให้นับว่า "มีผู้รัน" เกินจริง)

| แพ็กเกจ | ไฟล์ทดสอบทั้งหมด | อยู่ในสคริปต์ `test` | อยู่ในสคริปต์ใดก็ได้ของ `package.json` | ไม่มีสคริปต์ `package.json` ระบุ |
|---|---:|---:|---:|---:|
| `apps/api` | 738 | 511 | 527 | 211 (รันผ่าน catalog / workflow / เป็น `*.pg.spec.ts` / `KNOWN_FAILING`) |
| `apps/ai-gateway` | 73 | 51 | 51 | 22 — ในจำนวนนี้ 21 ไฟล์ถูกระบุชื่อใน whole-chain catalog (`reliability-gateway-v2`, `gateway-behavior`); เหลือ 1 ไฟล์ที่ไม่มีผู้รัน: `line-ai-turn.fixed-read.spec.ts` |
| `apps/workers` | 12 | 10 | 10 | 2 ไม่มีผู้รัน: `src/main.spec.ts`, `notification-delivery-demo.spec.ts` |
| `packages/contracts` | 28 | 13 | 13 | 15 — 12 ไฟล์ถูกระบุชื่อใน whole-chain catalog; เหลือ 3 ไฟล์ที่ไม่มีผู้รัน: `expense-evidence.spec.ts`, `expenses-wording.spec.ts`, `tax.spec.ts` |
| `packages/config` | 2 | 2 | 2 | 0 |
| `apps/web` | 359 | glob ทั้งหมด | — | 0 |

ผลที่ตามมาซึ่งต้องรู้: ไฟล์ที่ไม่มีใครรันจะ "เน่า" โดยไม่มีใครเห็น (เหตุผลที่เขียนไว้ในหัวไฟล์ `spec-suite-coverage.spec.ts`: เคยมี 52 ไฟล์ที่ไม่มีสคริปต์ใดอ้างถึง และสองไฟล์พังเงียบ ๆ) ทีมใหม่ที่เพิ่ม spec ต้องเพิ่ม path ลงสคริปต์ในการแก้ครั้งเดียวกัน

---

## 2. รายการทดสอบทั้งหมด (inventory)

รวมทั้ง repo: **1,341 ไฟล์** ที่ลงท้าย `.spec.*`/`.test.*` (TypeScript/JavaScript) และอีก **81 ไฟล์** `*.spec.sh`/`*_test.py` ของ infra รายชื่อครบทุกไฟล์อยู่ในภาคผนวก ก

### 2.1 สรุปตามแอป

| ที่อยู่ | จำนวนไฟล์ | หมายเหตุ |
|---|---:|---|
| `apps/api` | 738 | 728 ใต้ `src` (699 ใต้ `modules`, 29 นอก `modules` รวม 9 ใต้ `src/scripts`) และ 10 ใต้ `prisma` |
| `apps/web` | 359 | ทั้งหมดเป็น `src/**/*.spec.ts` (ไม่มี component test แบบ render; ทดสอบ logic, view-model, copy, guard) |
| `apps/ai-gateway` | 73 | |
| `apps/workers` | 12 | |
| `packages/contracts` | 28 | |
| `packages/config` | 2 | `index.test.ts`, `deployment-identity-manifest.test.ts` |
| `e2e` | 91 | 71 ที่ราก + 20 journey |
| `scripts` | 29 | golden/corpus/eval/rich-menu manifest |
| `infra` (JS) | 3 | `web-api-proxy.spec.mjs`, `mangmee-host-proxy.worker.spec.mjs`, `handler.spec.cjs` |
| `docs/evidence`, `docs/deliverables` | 7 | สำเนา spec ที่เก็บเป็นหลักฐาน ไม่อยู่ใน suite |
| `infra` (shell/python) | 81 | `infra/security` 31, `infra/prod-ecs-express` 19, `infra/docker` 8, `infra/kamal` 8, `infra/uat` 8, `infra/ai-gateway` 4, `infra/dev-kamal` 1, `infra/monitoring` 1, `infra/postmark` 1 |

### 2.2 `apps/api` — แยกตามโมดูล

| โมดูล (`apps/api/src/modules/…`) | ไฟล์ | พื้นที่ requirement |
|---|---:|---|
| `access-control` | 3 | CORE |
| `accounting-documents` | 23 | EXP (คู่ค้า/เอกสาร); ส่วนเอกสารขายดูหัวข้อ 9 |
| `ai-draft` | 12 | EXP, LINE |
| `audit` | 3 | CORE |
| `auth` | 45 | CORE, LINE (LINE login/handoff/webhook) |
| `banking` | 7 | ดูหัวข้อ 9 |
| `billing` | 64 | BILL |
| `crm` | 9 | CRM |
| `crm-inbox` | 43 | CRM |
| `dashboard-notifications` | 10 | CORE |
| `data-model-core` | 40 | CORE (บริษัท/สาขา/เลขเอกสาร/ไฟล์แนบ/outbox) |
| `data-rights` | 3 | CORE (PDPA) |
| `employee-access` | 19 | CORE |
| `executive-business` | 3 | ดูหัวข้อ 9 |
| `expenses` | 91 | EXP |
| `external-signup` | 30 | CORE, LINE, BILL (สมัครร้านใหม่) |
| `feature-launch` | 17 | CORE (launch gate) |
| `health` | 1 | CORE |
| `inventory` | 2 | ดูหัวข้อ 9 |
| `ledger` | 27 | EXP (การลงบัญชีรายจ่าย/ปิดงวด); ส่วน ledger เต็มดูหัวข้อ 9 |
| `line-ai` | 92 | LINE |
| `procurement` | 19 | ดูหัวข้อ 9 |
| `reimbursements` | 25 | EXP |
| `reports` | 6 | ดูหัวข้อ 9 |
| `sales-console` | 10 | BILL |
| `sales-demo` | 8 | BILL, LINE |
| `system-identity-reconciliation` | 1 | CORE |
| `system-onboarding` | 4 | CORE |
| `system-partner-management` | 30 | CORE, BILL |
| `tax` | 35 | TAX |
| `workflow` | 17 | ดูหัวข้อ 9 |
| **รวมใต้ `modules`** | **699** | |

| นอก `modules` | ไฟล์ | เนื้อหา |
|---|---:|---|
| `src/common/security` | 10 | `api-rate-limit.guard`, `canonical-fingerprint`, `injectable-di-token`, `liff-event-discount-page`, `liff-page-contrast`, `liff-start-handoff`, `redis-rate-limit.service`, `secret-compare`, `trusted-client-ip`, `worker-token` |
| `src/common/logger` | 4 | redaction และรูปแบบ log |
| `src/common/pipes` | 2 | validation pipe |
| `src/common/export`, `filters`, `middleware` | 1 + 1 + 1 | `thai-date.logic.spec.ts` (อยู่ใน `KNOWN_FAILING`), exception filter, middleware |
| `src/scripts` | 9 | logic ของ A5 evidence, chart-of-accounts audit, LINE identity inventory ฯลฯ |
| `src/spec-suite-coverage.spec.ts` | 1 | ตัวบังคับการลงทะเบียน spec (หัวข้อ 1.1) |
| `prisma/**/*.spec.ts` | 10 | `sync-permissions`, `seed-attachment-storage`, `run-exclusive-release-operation`, `bootstrap-a5-readonly`, `verify-applied-migration-catalog`, `verify-feature-launch-build-authority`, `verify-production-ready-migration`, `system-admin-cutover.pg`, `production-a5/*` (2) |

สคริปต์ย่อยที่มีชื่อใน `apps/api/package.json` (ใช้รันเฉพาะเรื่อง): `pretest` (5 ไฟล์ race/A5), `test:reimbursement-compatibility` (2), `test:release-recovery` (1), `test:a5-bootstrap` (1), `test:branch-tax-identity` (3), `test:tax-identity-pg` (1), `test:chart-audit` (1), `test:m01` (3, actor delegation), `test:p1` (6, security P1), `test:h03` (2), `test:h05` (3), `test:item11b-tax` (33), `test:line-ai-business-coverage` (12), `test:item11b-ai-tax` (2), `test:substitute-receipt` (6), `test:boot` (build + `boot-di-smoke`)

### 2.3 `apps/web` — แยกตาม feature

| ที่อยู่ (`apps/web/src/…`) | ไฟล์ | พื้นที่ |
|---|---:|---|
| `features/expenses` | 104 | EXP |
| `features/reimbursements` | 18 | EXP |
| `features/public-home` | 16 | BILL (หน้าแรกสาธารณะ/กิจกรรม) |
| `features/auth` | 16 | CORE |
| `features/employee-access` | 12 | CORE |
| `features/billing` | 12 | BILL |
| `features/external-signup` | 10 | CORE, LINE |
| `features/executive-reports` | 10 | ดูหัวข้อ 9 |
| `features/web-core-workspace` | 9 | CORE |
| `features/tax` | 7 | TAX |
| `features/system-partners` | 7 | CORE, BILL |
| `features/sales-console` | 7 | BILL |
| `features/crm` | 6 | CRM |
| `features/dashboard-notifications` | 5 | CORE |
| `features/sales-demo` | 4 | BILL, LINE |
| `features/counterparties` | 4 | EXP |
| `features/company-profile` | 4 | CORE |
| `features/branch-settings` | 4 | CORE |
| `features/accounts-payable` | 4 | EXP (ใบสำคัญจ่าย) |
| `features/user-guide` | 3 | CORE |
| `features/system-support-requests`, `system-signup-requests` | 3 + 3 | CORE, LINE |
| `features/accounting-documents` | 3 | EXP |
| `features/system-data-rights`, `plan-term`, `ledger`, `inventory`, `executive-users`, `crm-inbox`, `billing-admin` | อย่างละ 2 | CORE / BILL / CRM / ดูหัวข้อ 9 |
| `features/workflow`, `system-wht-income-categories`, `system-onboarding`, `reports`, `procurement`, `banking`, `ai-suggestions`, `accounting-tax-setup` | อย่างละ 1 | TAX / CORE / ดูหัวข้อ 9 |
| `common/components` | 27 | CORE (ส่วนประกอบร่วม) |
| `common/auth` | 9 | CORE |
| `common/api` | 7 | CORE |
| `common/i18n` | 5 | CORE |
| `common/files` | 4 | EXP |
| `common/styles`, `common/functions` | 3 + 3 | CORE |
| `common/security`, `common/forms` | 2 + 2 | CORE |
| `common/table`, `legal`, `hooks`, `client-support` | อย่างละ 1 | CORE |
| **รวม** | **359** | (293 ใต้ `features` จาก 38 feature, 66 ใต้ `common`) |

### 2.4 `apps/ai-gateway`, `apps/workers`, `packages/*`

| ที่อยู่ | ไฟล์ | พื้นที่ |
|---|---:|---|
| `ai-gateway/src/modules/line-ai/agents` | 31 | LINE |
| `ai-gateway/src/modules/line-ai/domain/logic` | 6 | LINE |
| `ai-gateway/src/modules/line-ai/infrastructure/provider` | 4 | LINE (Bedrock/OpenAI/disabled provider, public lookup) |
| `ai-gateway/src/modules/line-ai/application/**`, `presentation/http`, `infrastructure/**` | 1 + 3 + 3 + 1 + 1 | LINE |
| `ai-gateway/src/modules/crm-customer-ai/**` | 10 | CRM |
| `ai-gateway/src/modules/ai-draft` | 1 | EXP |
| `ai-gateway/src/agentcore` | 2 | LINE (AgentCore runtime) |
| `ai-gateway/src/common/**`, `auth`, ราก | 8 + 1 + 1 | CORE |
| `workers/src/common` | 4 | CORE (`internal-api`, `log`, `queue`, `retry-schedule`) |
| `workers/src/modules/*` | 7 | `outbox`, `notifications` (2), `expense-auto-post` (EXP), `object-version-cleanup`, `plan-term-sweep` (BILL), `signup-claim-email` |
| `workers/src/main.spec.ts` | 1 | CORE |
| `packages/contracts/src` | 28 | CORE/BILL (`feature-entitlements`, `plan-term`, `billing-addon`, `billing-company-profile`), EXP (`expense-evidence`, `expenses-wording`, `reimbursements`), TAX (`tax`, `company-tax-identity`), LINE (`line-ai-*` 7 ไฟล์, `line-document-qa`, `line-external-browser`, `line-reimbursement-draft`), PDPA (`data-rights`, `legal-acceptance`) |
| `packages/config/src` | 2 | CORE (schema ของ environment และ deployment identity) |

### 2.5 E2E ที่ราก `e2e/` (71 ไฟล์)

คอลัมน์ "ทดสอบ" คือจำนวนบรรทัด `test(` ที่นับได้ด้วย grep (ไฟล์ที่วนสร้าง test ตามขนาดจอจะรันจริงมากกว่านี้) "@smoke" คือจำนวนที่ติดแท็กเข้า project `critical`

| ไฟล์ | เส้นทาง/เรื่องที่ครอบคลุม | ทดสอบ | @smoke | พื้นที่ |
|---|---|---:|---:|---|
| `_reference.spec.ts` | โมดูลที่พร้อมใช้ render ได้ภายใต้ auth จริง | 3 | 1 | CORE |
| `_roles-reference.spec.ts` | harness ล็อกอินหลายบทบาท | 6 | 5 | CORE |
| `login.spec.ts` | ล็อกอินและ session | — | 2 | CORE |
| `account-email-otp-ux.spec.ts` | เปลี่ยนอีเมลด้วย OTP: เก็บ draft ที่ล้ม, เคารพ rate limit | 4 | 0 | CORE |
| `legal-acceptance.spec.ts` | ยอมรับข้อกำหนดและรับทราบ Privacy Notice | 1 | 1 | CORE |
| `settings.spec.ts` | ตั้งค่าร้าน/สาขา/พนักงาน | 19 | 2 | CORE |
| `system-admin.spec.ts` | คอนโซลผู้ดูแลระบบ | 13 | 1 | CORE |
| `system-settings-ux.spec.ts` | เปลี่ยนชื่อเจ้าของจากคอนโซล, เก็บ draft เมื่อชน | 4 | 0 | CORE |
| `system-support-resolution.spec.ts` | ปิดคำขอคุยกับเจ้าหน้าที่ | 5 | 0 | CORE, LINE |
| `employee-job-title.spec.ts` | ตำแหน่งงานพนักงาน | — | 0 | CORE |
| `branch-scope.spec.ts` | การมองเห็นตามสาขา | 5 | 0 | CORE |
| `transaction-branch.spec.ts` | API ปฏิเสธการสร้างที่สาขากำกวม | 5 | 0 | CORE, EXP |
| `sidebar-nav.spec.ts` | สถานะ active ของเมนู | 6 | 0 | CORE |
| `dashboard.spec.ts`, `daily-brief.spec.ts` | แดชบอร์ดและสรุปรายวัน | 4 + 2 | 1 | CORE |
| `notifications.spec.ts` | การแจ้งเตือน | 4 | 1 | CORE |
| `toast-feedback.spec.ts` | ข้อความ feedback กลาง | 2 | 0 | CORE |
| `client-support.spec.ts` | แจ้งเตือนเบราว์เซอร์ที่ไม่รองรับ | 3 | 0 | CORE |
| `cross-cutting.spec.ts` | เรื่องข้ามโมดูล | 5 | 1 | CORE |
| `profile-completeness-card.spec.ts` | การ์ดกรอกข้อมูลร้านให้ครบ | 2 | 0 | CORE |
| `feature-entitlement-accessibility.spec.ts` | fallback ของฟีเจอร์ที่ไม่ได้ซื้อ (accessibility) | 1 | 0 | CORE, BILL |
| `local-active-feature-regression.spec.ts` | แดชบอร์ดงานของฟีเจอร์ที่เปิด + ลำดับบนมือถือ | 6 | 0 | CORE |
| `responsive.spec.ts`, `responsive-baseline.spec.ts`, `evidence.spec.ts` | เป้ากด/การล้นจอ/ภาพหลักฐาน INV-11 | 28 + 2 + 6 | 0 | CORE |
| `liff-xss.spec.ts` | ความปลอดภัยเบราว์เซอร์ของหน้า LIFF (H-08) | 2 | 0 | LINE |
| `line-recovery.spec.ts` | กู้การผูก LINE และทางออกไปหาเจ้าหน้าที่ | 3 | 0 | LINE |
| `line-signup-contact-email.spec.ts` | สมัครผ่าน LINE โดยไม่ตั้งรหัสผ่าน, อีเมลติดต่อ | 5 | 0 | LINE |
| `autonomy-toggle.spec.ts`, `ai-suggestions.spec.ts` | สวิตช์ความอัตโนมัติของ AI, ข้อเสนอจาก AI | 2 + 2 | 1 | LINE, EXP |
| `expenses.spec.ts` | รายจ่ายและใบเสร็จ (ชุดหลัก) | 37 | 5 | EXP |
| `expense-capture-intake.spec.ts`, `.evidence.spec.ts` | รับเอกสารเข้าระบบสามทางโดยไม่มีหน้าจอใหม่ | 6 + 1 | 0 | EXP |
| `expense-number-save.spec.ts`, `expense-running-number.spec.ts` | เลขเอกสารรายจ่าย: กู้คำสั่งที่ response หาย, reject/reopen/void | 3 + 2 | 0 | EXP |
| `manual-expense-web-entry.spec.ts` | สวิตช์ "บันทึกด้วยมือ" รายร้าน | 3 | 0 | EXP |
| `receipt-draft-continuity.spec.ts` | ใบเสร็จไม่ครบยังบันทึกต่อได้ | 14 | 0 | EXP |
| `substitute-cancelled-view-only.spec.ts`, `substitute-editable-navigation.spec.ts` | ใบรับรองแทนใบเสร็จ: ดูอย่างเดียว/ย้อนแก้เลขเดิม | 2 + 2 | 0 | EXP |
| `reimbursements.spec.ts`, `reimbursement-receipt.spec.ts` | ใบเบิกและไฟล์แนบ | 17 + 2 | 1 | EXP |
| `accounts-payable.spec.ts` | เจ้าหนี้/ใบสำคัญจ่าย | 7 | 1 | EXP |
| `counterparties.spec.ts` | สิทธิ์ทะเบียนคู่ค้า | 2 | 0 | EXP |
| `income-expense-ledger.spec.ts` | สมุดรายรับรายจ่าย (P27) | 7 | 6 | EXP |
| `transaction-tax.spec.ts` | Tax Code ระดับรายการ (11B) | 3 | 2 | TAX |
| `wht-settlement.spec.ts`, `withholding-page.spec.ts` | หัก ณ ที่จ่ายตอนจ่าย, หน้าแบบภาษี | 2 + 4 | 0 | TAX |
| `crm.spec.ts`, `crm-reports.spec.ts` | inbox/ลูกค้า/หลักฐานการโอน, รายงาน CRM | 10 + 3 | 1 | CRM |
| `bookings.spec.ts` | การจอง | 6 | 1 | CRM |
| `billing-no-setup.spec.ts` | ร้านที่ล็อกซื้อ STARTER โดยไม่กรอกอีเมล/ที่อยู่ | 4 | 0 | BILL |
| `billing-promotion.spec.ts` | โปรโมชัน Starter (PROMO-01…) | 79 | 0 | BILL |
| `billing-advance-deal.spec.ts` | ดีลจ่ายล่วงหน้าเริ่มที่ขอบรอบเดิม | 1 | 0 | BILL |
| `billing-preview.spec.ts` | พรีวิวการซื้อ | — | 0 | BILL |
| `customer-billing-ux.spec.ts` | หน้าแพ็กเกจและตัวเลือกของลูกค้า | 4 | 0 | BILL |
| `plan-term-billing-readiness.spec.ts` | ความพร้อม billing ด้วยการจ่ายจำลอง | 24 | 0 | BILL |
| `billing-admin-directory.spec.ts`, `billing-admin-menu-ux.spec.ts`, `billing-admin-document-tools.spec.ts` | คอนโซล billing ของผู้ดูแล | 14 + 13 + 2 | 0 | BILL |
| `sales-console.spec.ts` | คอนโซลทีมขาย | 1 | 0 | BILL |
| `accounting.spec.ts`, `journal.spec.ts`, `banking.spec.ts`, `inventory.spec.ts`, `procurement.spec.ts`, `reports.spec.ts`, `reports-bi-smoke.spec.ts`, `executive-report.spec.ts`, `workflow.spec.ts`, `business-smoke.spec.ts` | เอกสารบัญชี/สมุดรายวัน/ธนาคาร/สต๊อก/จัดซื้อ/รายงาน/workflow | 6, 7, 2, 11, 4, 8, 1, 2, 2, 1 | 2, 2, 1, 2, 1, 2, 0, 0, 1, 0 | ดูหัวข้อ 9 |

### 2.6 Journey test (`e2e/journeys/`, 20 ไฟล์)

| ไฟล์ | เส้นทางที่เดิน | พื้นที่ |
|---|---|---|
| `plain-shop-records-everything.journey.spec.ts` | ร้านทั่วไปบันทึกใบเสร็จ, ใบกำกับ VAT, อัปโหลดจากมือถือ, ใบรับรองแทนใบเสร็จ และใบเบิกที่จ่ายแล้ว | EXP |
| `staff-receipt-from-phone.journey.spec.ts` | พนักงานส่งใบเสร็จจากมือถือ เติมข้อมูลสองรอบ เจ้าของยืนยันและจ่าย | EXP |
| `no-receipt-certificate.journey.spec.ts` | ซื้อของไม่มีใบเสร็จ → ใบรับรองแทนใบเสร็จ → ยืนยัน | EXP |
| `paid-expense-reopened.journey.spec.ts` | เปลี่ยนใบเสร็จของรายจ่ายที่จ่ายแล้วถูกปฏิเสธพร้อมเหตุผลและทางออก | EXP |
| `claim-declined-then-paid.journey.spec.ts` | ใบเบิกถูกปฏิเสธและยกเลิก ใบที่สองอนุมัติ จ่าย และเห็นว่าจ่ายแล้ว | EXP |
| `payment-document-two-people.journey.spec.ts` | การเงินเตรียมเอกสารจ่าย ผู้จัดการอนุมัติจากการแจ้งเตือน จ่าย กลายเป็นใบสำคัญจ่ายเลขเดิม | EXP |
| `voucher-supporting-files.journey.spec.ts` | แนบ/ลบ/เปิดไฟล์ประกอบใบสำคัญจ่าย | EXP |
| `evidence-and-settings.journey.spec.ts` | ดาวน์โหลดไฟล์ให้นักบัญชี, ปิดสาขา, ประวัติการแก้ชื่อพนักงาน | EXP, CORE |
| `shop-menus-everyday.journey.spec.ts` | เพิ่ม/เปลี่ยนชื่อหมวด, ที่อยู่คู่ค้า, ตั้งค่าร้าน, แพ็กเกจ, อ่านคู่มือทั้งสาม | CORE, EXP |
| `team-and-roles.journey.spec.ts` | สร้างบทบาทและสมาชิก ให้สิทธิ์ แล้วปิดสมาชิก | CORE |
| `expense-input-vat-right.journey.spec.ts` | สิทธิ์ภาษีซื้อ: ร้านตอบจากลิงก์ เจ้าของตัดสินภายหลัง นักบัญชีได้ทั้งสองคำตอบ | TAX, EXP |
| `withholding-forms.journey.spec.ts` | รายจ่ายหัก ณ ที่จ่ายสามรายการ แก้ข้อผิดของร้านผ่านลิงก์ ดาวน์โหลดแบบและ 50 ทวิ ยื่นเดือน | TAX |
| `e-wht-payment.journey.spec.ts` | เปิด e-WHT, ตรวจ RATE/AMOUNT, จ่ายผ่านธนาคาร, ใบสำคัญ, เดือนที่ธนาคารนำส่ง | TAX |
| `package-upgrade-unlocks-50-tawi.journey.spec.ts` | ร้านแพ็ก 999 บันทึกการจ่ายที่หักภาษี เมื่อเป็น 1999 รายจ่ายเดิมออก 50 ทวิได้ทันที | TAX, BILL |
| `billing-first-promptpay.journey.spec.ts` | D1 ซื้อครั้งแรกด้วย PromptPay | BILL |
| `billing-first-card-renewal.journey.spec.ts` | D2 ซื้อครั้งแรกแบบต่ออายุอัตโนมัติด้วยบัตร | BILL |
| `billing-renew-or-top-up.journey.spec.ts` | D3 จากการเตือนสู่การต่อแพ็กเดิมหนึ่งรอบ | BILL |
| `billing-stop-auto-renewal.journey.spec.ts` | D4 หยุดต่ออายุอัตโนมัติ | BILL |
| `billing-unfinished-payment.journey.spec.ts` | D5 ออกจาก checkout กลับมาทำต่อ แล้วปิดรายการที่ไม่จ่าย | BILL |
| `public-home.journey.spec.ts` | หน้าแรกสาธารณะ | BILL |

ไฟล์ช่วย: `e2e/journeys/journey-kit.ts`, `e2e/journeys/e-wht-journey-kit.ts`, harness ใน `e2e/harness/` (`auth.ts`, `roles.ts`, `fixtures.ts`, `e2e-utils.ts`, `expense-capture.ts`, `inv11.ts`, `screen-fit.ts`), fixture `e2e/billing-no-setup.fixture.ts`, `e2e/billing-promotion.fixture.ts`

### 2.7 HTTP smoke script (`apps/api/src/scripts/`, 66 ไฟล์)

| กลุ่ม | ไฟล์ | พื้นที่ |
|---|---|---|
| Billing — เส้นหลัก | `billing-http-smoke.ts` (ตัวประสาน เลือกชุดย่อยด้วยตัวแปร `BILLING_*_ONLY`), `billing-configuration-smoke.ts`, `billing-browser-smoke.ts`, `billing-readiness-smoke.ts` | BILL |
| Billing — การซื้อ/ต่ออายุ | `billing-no-setup`, `billing-upgrade`, `billing-plan-change`, `billing-restart`, `billing-repeat`, `billing-repeat-apply`, `billing-apply-retry`, `billing-purchase-recovery`, `billing-checkout-expiry`, `billing-portal`, `billing-free-days` | BILL |
| Billing — การเงิน/คืนเงิน | `billing-financial`, `billing-settlement`, `billing-collection`, `billing-admin-collection`, `billing-refunds`, `billing-refund-controls`, `billing-adjustments`, `billing-receipt-adjustments`, `billing-plan-adjustments`, `manual-receipt-adjustments`, `partner-plan-adjustments`, `admin-ai-adjustments` | BILL |
| Billing — ผู้ดูแล/นโยบาย | `billing-admin`, `billing-cases`, `billing-batches`, `billing-scopes`, `billing-feature-controls`, `billing-offer-matrix`, `billing-offer-terms`, `billing-scheduled-policy`, `billing-configuration-drafts`, `billing-configuration-impact`, `billing-sales-cohort`, `billing-support-outcomes`, `billing-support-sla`, `billing-company-read`, `billing-history-export`, `billing-marketing` | BILL |
| Billing — ผู้ให้บริการ/เอกสาร | `billing-provider-events`, `billing-provider-scans`, `billing-scan-schedule`, `billing-invoice-import`, `billing-invoice-scans`, `billing-notification`, `billing-delivery-recovery`, `billing-mail-recovery` | BILL |
| อีเมล | `email-access`, `email-verification`, `email-password-reset`, `email-monitoring`, `email-retention`, `postmark-http` | CORE |
| สมัคร/ผูก LINE | `signup-journey`, `signup-claim-history`, `line-binding`, `line-runtime-credentials` | LINE, CORE |
| อื่น | `receipt-quota-runtime-smoke` (EXP/BILL), `partner-ai-support-smoke` (CORE), `m01-actor-delegation-live-smoke` (LINE security), `chart-of-accounts-tax-smoke` (TAX), `boot-di-smoke` (CORE) | — |

Smoke อื่นนอกโฟลเดอร์นี้: `apps/api/src/modules/line-ai/line-webhook-local-smoke.ts` (ยิง webhook LINE จำลองใส่ API local; ตัวแปร `API_URL`, `LINE_LOCAL_USER_ID`, `SMOKE_SCENARIO`), `apps/ai-gateway/src/modules/line-ai/agents/orchestrator-smoke.ts`, `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider-smoke.ts`, `infra/docker/api-runtime-smoke.cjs`, `scripts/line-ai-reliability-compiled-smoke.cjs`, `scripts/line-ai-reliability-optout-smoke.ts`

### 2.8 Golden, corpus และ AI harness (`scripts/`, 29 ไฟล์ทดสอบ)

| ไฟล์ | ล็อกอะไร | ผู้รัน (ตรวจจากการอ้างชื่อไฟล์) |
|---|---|---|
| `line-ai-latency-autonomy.corpus.spec.ts` | corpus ของ lane เวลา/ความอัตโนมัติ | `pnpm test:harness` |
| `expense-category.golden.spec.ts` | หมวดรายจ่ายที่คาดหวังต่อข้อความ | `pnpm test:harness` |
| `expense-capture-read.fixtures.spec.ts` | ผลอ่านเอกสาร (fixture) | `pnpm test:harness` |
| `brain-family-questions.golden.spec.ts` | ตระกูลคำถามของ "สมอง" | `pnpm test:harness` |
| `line-ai-reliability-corpus.spec.ts`, `line-ai-reliability-evaluation.spec.ts`, `line-ai-reliability-fixtures.spec.ts`, `line-ai-reliability-runtime.spec.ts`, `line-ai-reliability-blind-comparison.spec.ts` | เครื่องมือ replay ความน่าเชื่อถือ | whole-chain catalog |
| `line-ai-expense-advisor/{oracle,report,run-rescore,scorer,template,types}.spec.ts` | harness ประเมิน advisor (scorer ไม่เรียกโมเดล) | whole-chain catalog (`reliability-contracts-evaluation-v2`) |
| `line-ai-intake-cost.corpus.spec.ts` | ต้นทุน intake | ไม่พบผู้รันที่ระบุชื่อ — รันด้วยมือ `tsx --test` |
| `line-ai-natural-conversation-corpus.spec.ts`, `line-ai-natural-wire-report.spec.ts` | บทสนทนาธรรมชาติและรายงาน wire | ไม่พบผู้รันที่ระบุชื่อ |
| `line-ai-operator-language.corpus.spec.ts`, `run-line-ai-operator-language-eval.spec.ts`, `run-line-ai-operator-language-replay.spec.ts` | ภาษาของผู้ปฏิบัติงาน | ไม่พบผู้รันที่ระบุชื่อ |
| `line-ai-substitute-routing.corpus.spec.ts` | การ route เรื่องใบรับรองแทนใบเสร็จ | ไม่พบผู้รันที่ระบุชื่อ |
| `line-ai-reliability-runtime-reset.pg.spec.ts` | การ reset runtime กับ PostgreSQL | ไม่พบผู้รันที่ระบุชื่อ (ต้องมีฐานข้อมูล) |
| `line-ai-whole-chain-acceptance-catalog.spec.mjs` | ความถูกต้องของตัว catalog | ไม่พบผู้รันที่ระบุชื่อ |
| `run-line-ai-controlled-image-replay.spec.mjs` | replay รูปแบบควบคุม | ไม่พบผู้รันที่ระบุชื่อ |
| `line-oa/rich-menu-v2-ver{1,2,3}.manifest.spec.mjs` | manifest ของ rich menu | รันด้วยมือ `node --test` |
| `qa/journey-mobile.spec.ts` | สคริปต์ journey บนมือถือ | รันด้วยมือ |

"ไม่พบผู้รันที่ระบุชื่อ" หมายถึงชื่อไฟล์ไม่ปรากฏใน `package.json` ราก, `scripts/line-ai-whole-chain-acceptance.catalog.mjs`, `.github/workflows/ci.yml` หรือ `extended-tests.yml`; `scripts/local-proof/verify.sh` ก็ไม่ได้ระบุชื่อไฟล์เหล่านี้

ขั้นของ `scripts/local-proof/verify.sh` ตามลำดับในโค้ด (บรรทัด 17–50): `contracts-build` → `prisma-validate` → `prisma-generate` → `migration-review` → `pins` → `di-metadata` → `tsc` (API + web) → `typecheck-others` → `contracts-test` → `web-test` → `loading-audit` (`scripts/qa/action-loading-coverage.mjs --check`) → `api-test` → `harness` → `whole-chain` → `m01` → `p1` → `ai-gateway-test` → `pins-validator-spec` → `pins-sync-spec` สังเกตว่า **ไม่มีขั้นของ `apps/workers` และ `packages/config`** ต้องรันแยกด้วย `pnpm --filter … test`

Corpus ที่อยู่ใน repo: `scripts/line-ai-expense-advisor/corpus.{sample,tuning,heldout}.json`, `corpus.workflow.{sample,tuning,oracle-sample}.json` ชุด held-out ของ workflow (202 บทสนทนา) และชุด blind v4–v14 **ถูกเก็บนอก repo โดยตั้งใจ** (`docs/research/line-ai-workflow-baseline-2026-10.md`) จึงไม่อยู่ใน archive ของโค้ด

---

## 3. สภาพแวดล้อมและข้อมูลทดสอบ

### 3.1 Local stack

| ทาง | คำสั่ง | สิ่งที่ได้ |
|---|---|---|
| Docker ทั้งชุด | `cp .env.example .env && pnpm install && pnpm docker:local` | web `:3000`, API `:3001/v1/health`, ai-gateway `:3002/v1/health`, PostgreSQL 16 `:15432`, Redis 7 `:6379`, MinIO `:19000` (console `:19001`) — `infra/docker/compose.local.yml` |
| เฉพาะ infra | `pnpm docker:local:infra` | postgres, redis, minio, minio-create-bucket |
| E2E | `e2e/run-local.sh [args]` | Playwright build และเปิด API/web เอง; script ตรวจ PostgreSQL native `:5432`, schema ล่าสุด, seed และ MinIO ก่อน |

ข้อควรรู้ที่ `README.md` บันทึกไว้: `pnpm dev` รันเดี่ยวไม่ได้เพราะ `ai-gateway`/`workers` ต้องมี `APP_ENV` และ `SERVICE_NAME` จาก compose; `apps/api/.env` ที่ Prisma สร้างอาจทับ `DATABASE_URL`; PostgreSQL ของ compose เปิดที่ `15432` ไม่ใช่ `5432` ขณะที่ `playwright.config.ts` ใช้ค่าเริ่มต้น `5432` (ฐานข้อมูล native ที่ seed แล้ว)

`playwright.config.ts` กำหนดค่าเฉพาะการทดสอบ: `APP_ENV=local`, `AUTH_PROVIDER=dev`, `DEV_AUTH_ENABLED=true`, และค่า placeholder ของ `DEV_AUTH_SECRET`, `WATCHDOG_JWT_SECRET_ARN`, `CREDENTIAL_ENCRYPTION_KEY`, `PDPA_PSEUDONYMIZATION_KEY` ที่ใช้ได้เฉพาะ local (ตัวตรวจ production ปฏิเสธค่าเหล่านี้ — `packages/config/src/index.ts` `validateProductionConfig`) API build ลง `dist/e2e-<port>` แยกตาม port เพื่อให้รันสองชุดพร้อมกันใน checkout เดียวได้

### 3.2 Proof stack และ merge gate (`docs/runbooks/local-proof-stack-and-merge-gate.md`)

| Stack | Port | ฐานข้อมูล | ใช้โดย | กติกา |
|---|---|---|---|---|
| Trial ของเจ้าของ | web 3140, API 3141 | `watchdog_pvtry` | เจ้าของ | รับเฉพาะงานที่ merge และผ่าน gate แล้ว; agent ห้ามเขียน |
| Proof | web 3150, API 3151 | `watchdog_pv_proof` | journey test, ผู้ review | ล้างและ seed ใหม่ก่อนทุก gate (ราว 20 วินาที) |
| Real-database spec | — | `watchdog_pv_land` | `*.pg.spec.ts` และ repository spec | gate เป็นผู้ migrate |

เครื่องมืออยู่ใน `scripts/local-proof/`: `gate.sh`, `verify.sh`, `realpg.sh`, `prove.sh`, `proof-reset.sh`, `proof-start.sh`, `proof-stop.sh`, `proof-journeys.sh`, `trial-after-merge.sh`, `trial-start.sh`, `repin.sh`, `heavy.sh`, `tsc.sh` (ตัวช่วยภายใน `common.sh`, `stack.sh`, `result.sh`; ตั้งค่าใน `settings.local.sh` คัดลอกจาก `settings.example.sh`) URL ของ PostgreSQL/Redis ต้องเป็น localhost เท่านั้น; การ reset ต้องตรงชื่อฐานข้อมูล proof ที่ตั้งไว้; การหยุดไม่ฆ่า process ตามชื่อ

### 3.3 Seed และ fixture

| ไฟล์ | เนื้อหา |
|---|---|
| `apps/api/prisma/seed.ts` | บริษัทตัวอย่าง (ร้าน Room45 สามสาขา, พนักงานตัวอย่าง), ผู้ใช้ `Owner`, `Company`, บัญชี QA ทีมขาย `qa.mangmee.lead`/`qa.mangmee.sales`, ผู้ดูแลระบบ; รหัสผ่านอ่านจาก `SEED_OWNER_PASSWORD`, `SEED_COMPANY_VIEW_PASSWORD`, `SEED_SYSTEM_ADMIN_PASSWORD` |
| `apps/api/prisma/seed-plain-shop.ts` | ร้านทั่วไปสำหรับ journey |
| `apps/api/prisma/seed-expenses.ts` | ชุดรายจ่าย |
| `apps/api/prisma/seed-attachment-storage.ts` | ไฟล์แนบใน object storage |
| `apps/api/prisma/sync-permissions.ts`, `sync-thai-address-master.ts`, `sync-workflow-templates.ts`, `sync-feature-launch-gates.ts` | ข้อมูลอ้างอิงที่ release ทุกครั้งต้อง sync (ไม่ใช่ข้อมูลทดสอบ) |
| `apps/api/prisma/data/`, `apps/api/prisma/verification/` | ข้อมูลอ้างอิงและ SQL ตรวจสอบ |
| `docs/fixtures/` | เอกสารตัวอย่าง |
| `scripts/line-ai-expense-advisor/seed.ts` | บริษัท A (Starter) และ B (Pro) สำหรับการประเมิน AI สร้างจาก registry จริง (`ROLE_GRANTS`, `SYSTEM_ROLES`, `PERMISSIONS`, `TIER_FEATURE_PRESETS`) |

### 3.4 นโยบายบัญชีทดสอบ

- ไม่มีรหัสผ่านใดถูก commit ค่าจริง: seed อ่านจาก environment; `SEED_SYSTEM_ADMIN_PASSWORD` ถูกห้ามใน production โดย `validateProductionConfig`
- บน production ห้ามใช้บัญชี seed หรือ reset รหัสเพื่อทำ acceptance (`docs/runbooks/uat-production-v2-deployment.md` ขั้น E); การยอมรับใช้ session ที่เจ้าของล็อกอินเอง
- Kamal acceptance ใช้ไฟล์ JSON ส่วนตัวนอก git (`acceptanceCredentials` ใน `.env.kamal/<env>/target.json`)
- อีเมล UAT ส่งออกได้เฉพาะผู้รับใน `POSTMARK_UAT_ALLOWED_RECIPIENTS`
- ข้อมูลลูกค้าจริงห้ามใส่ใน ticket, metric label หรือหลักฐาน (`docs/runbooks/customer-journey-signal-triage.md`)

### 3.5 Stripe test mode

`BILLING_MODE` มีสามค่า `disabled | test | live` (`packages/config/src/index.ts`) UAT ใช้ `test`; production ตั้ง `live` ใน `infra/kamal/config.json` Smoke ของ billing รันกับ PostgreSQL แยก (`BILLING_TEST_DATABASE_URL`) และ provider จำลองภายใน script; E2E `plan-term-billing-readiness.spec.ts` ใช้ "การจ่ายจำลอง" หลักฐานการลอง sandbox จริงอยู่ที่ `docs/evidence/billing-payment-modes-stripe-sandbox-2026-09-20.md` และการซื้อ+คืนเงินจริงบน production ถูกพิสูจน์ครั้งเดียวตอน go-live (ดูเอกสาร 08)

### 3.6 LINE: การทดสอบโดยไม่ใช้ LINE จริง

| วิธี | ที่อยู่ |
|---|---|
| ยิง webhook จำลองใส่ API local | `apps/api/src/modules/line-ai/line-webhook-local-smoke.ts` |
| Replay บทสนทนาผ่าน runtime จริงโดยไม่มี LINE | `scripts/line-ai-reliability-runtime.ts`, `scripts/run-line-ai-controlled-conversation.ts`, `scripts/run-line-ai-controlled-image-replay.mjs` |
| แชต demo บนเว็บ (ผู้ใช้ `Vdemo<companyId>`) ที่เดินผ่าน LINE AI ตัวจริง | โมดูล `sales-demo`, `apps/api/src/modules/auth/infrastructure/demo-outbound.spec.ts` |
| LINE channel จริงกับเครื่อง local ผ่าน tunnel | `docs/runbooks/line-ai-local-agent-10b-runbook.md` |
| OA ของ UAT | `@234jrspv` (ปิดแล้ว ดูเอกสาร 08) |

หมายเหตุ: ไม่พบ harness ที่ชื่อ "LINE fake harness" เป็นไฟล์เดี่ยวใน checkout นี้ การทดสอบสมัครผ่าน LINE ในเครื่องใช้ `signup-journey-smoke.ts` และ E2E `line-signup-contact-email.spec.ts`

---

## 4. วิธีรันแต่ละชุด, ชุดที่ไม่นิ่ง, และ CI workflow

### 4.1 คำสั่ง (จาก `package.json` ราก, ของแต่ละแพ็กเกจ และ `turbo.json`)

| ชุด | คำสั่ง |
|---|---|
| ทุกแพ็กเกจ | `pnpm test` (= `corepack pnpm -r --if-present test`) |
| Typecheck ทุกแพ็กเกจ | `pnpm typecheck` — ของ API ต้องใช้สคริปต์ของแพ็กเกจเพราะตั้ง `NODE_OPTIONS=--max-old-space-size=8192`; ของ web รัน `next typegen` ก่อน |
| Lint | `pnpm lint` (ทุกแพ็กเกจคือ `tsc --noEmit`; design-tokens คือ `build-tokens.mjs --check`) |
| API unit | `pnpm --filter @watchdog-bms/api test` (รัน `pretest` ก่อนอัตโนมัติ) |
| API เฉพาะเรื่อง | `pnpm --filter @watchdog-bms/api test:p1` / `test:m01` / `test:item11b-tax` / `test:substitute-receipt` / … (รายการในหัวข้อ 2.2) |
| API boot | `pnpm --filter @watchdog-bms/api test:boot` |
| API ไฟล์เดียว | `pnpm --filter @watchdog-bms/api exec tsx --test <path>` |
| Web | `pnpm --filter @watchdog-bms/web test` |
| AI gateway | `pnpm --filter @watchdog-bms/ai-gateway test`, `test:line-ai-business-coverage` |
| Workers | `pnpm --filter @watchdog-bms/workers test` |
| Contracts / config / tokens | `pnpm --filter @watchdog-bms/contracts test`, `pnpm --filter @watchdog-bms/config test`, `pnpm --filter @watchdog-bms/design-tokens test` |
| Harness golden | `pnpm test:harness` |
| LINE whole-chain | `node scripts/run-line-ai-whole-chain-acceptance.mjs` (โหมด PostgreSQL ต้องมี `BILLING_TEST_DATABASE_URL`) |
| E2E ทั้งชุด | `pnpm e2e` หรือ `e2e/run-local.sh` |
| E2E critical | `pnpm e2e:critical` (project `critical`, แท็ก `@smoke`) |
| Journey | `e2e/run-local.sh --grep @journey` หรือ `bash scripts/local-proof/proof-journeys.sh <tag>` |
| Responsive / evidence | `pnpm e2e --project=mobile-375` ฯลฯ แล้ว `node scripts/build-evidence-manifest.mjs [evidenceDir]` |
| Merge gate | `bash scripts/local-proof/gate.sh <tag>` แล้วอ่าน `.local-proof/results/<tag>.gate` |
| Re-pin | `bash scripts/local-proof/repin.sh` (หลังแก้ถ้อยคำ/ไฟล์ที่ถูก guard; ต้องอ่าน diff เอง) |
| ตรวจ config production | `pnpm config:validate [ไฟล์ env] [--service <ชื่อ>]` |
| Security audit | `pnpm security:audit` (ระดับ high) |
| หลักฐาน scanner M-14 | `pnpm security:m14-evidence` (ต้องมี clamd จริง) |
| Legal release gate | `pnpm legal:release-gate` |
| Prisma | `pnpm --filter @watchdog-bms/api prisma:validate`, `migration:review` |
| Infra controller | `python3 infra/kamal/release_test.py`, `python3 infra/kamal/shutdown_test.py`, `bash infra/docker/production-image-security.spec.sh`, `bash infra/monitoring/runtime-alarms.spec.sh`, `node infra/security/sync-production-maintenance-release-pins.mjs --check` |
| Load smoke | `k6 run scripts/load-smoke.k6.js` |
| Agent gate (เอกสารเก่า) | `pnpm agent:gates -- <ไฟล์>` |

`turbo.json`: task `test`, `lint`, `typecheck` ขึ้นกับ `^build` (ต้อง build `@watchdog-bms/config` และ `@watchdog-bms/contracts` ก่อน); `build` รับ env `INTERNAL_API_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AI_GATEWAY_BASE_URL`

### 4.2 ชุดที่ไม่นิ่ง ชุดที่ขึ้นกับวันที่ และข้อจำกัดที่บันทึกไว้

| เรื่อง | รายละเอียด | แหล่ง |
|---|---|---|
| spec ที่รู้ว่าล้ม (ยกเว้นจาก suite) | `common/export/thai-date.logic.spec.ts` (golden SHA-256 ของ CSV ดัชนีนักบัญชีไม่ตรงผลจริง); `modules/data-model-core/presentation/http/object-version-cleanup-internal.controller.spec.ts` (ได้ `UnauthorizedException` แม้ตั้ง token เอง) | `apps/api/src/spec-suite-coverage.spec.ts` `KNOWN_FAILING` |
| ชุดช่วยเหลือ LINE หมดอายุ | `PRODUCT_HELP_PACK.effectiveTo` และ `reviewDueAt` = `2026-12-27T00:00:00+07:00`; หลังวันนั้น approved knowledge คืน `null` และ spec ที่ตรึงวันที่ต้องทบทวนพร้อมชุดใหม่ | `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.ts`, `.spec.ts` |
| Journey ต้องการฐานข้อมูลใหม่ | journey ภาษีหัก ณ ที่จ่าย "ยื่นเดือน" ซึ่งล็อกเดือนนั้น รันซ้ำบนฐานเดิมไม่ได้ | runbook proof stack |
| Journey พลาดครั้งแรก 1 รายการ | 87/88 แล้ว 88/88 จากการรอ first-visit ของหน้า "บันทึกด้วยมือ" พบซ้ำ 10-15, 10-19, 10-21 | `docs/agent-memory/security-fix-plan-2026-10-21.md` |
| Eval ข้ามเที่ยงคืนไม่ได้ | การรัน replay ข้ามเที่ยงคืนเวลาไทยล้มด้วย `REPLAY_FIXTURE_BUSINESS_DATE_CHANGED`; process เดียวกินหน่วยความจำ ~75 MB ต่อบทสนทนา ต้องแบ่งรอบละ 25 | `docs/research/line-ai-workflow-baseline-2026-10.md` |
| Eval ต้องเครื่องว่าง | รันพร้อมงานหนักอื่นทำให้ได้ timeout ปลอม 34 จาก 40 ความล้มเหลว | เอกสารเดียวกัน |
| Bedrock throttling | โควตา Sonnet 4.6 ของบัญชีถูกตั้งที่ 10 request/นาที ทำให้ eval และ production ช้า/ถูกจำกัด | `docs/runbooks/cloud-environment-operations.md` (บันทึก 2026-11-09) |
| `next dev` แก้ไฟล์ที่ track | `apps/web/next-env.d.ts` ถูกเขียนใหม่ตาม `NEXT_DIST_DIR`; ต้องไม่ commit รูปแบบ dev | ความเห็นใน `playwright.config.ts`, `e2e/HANDOFF.md` |
| EXP-06 ถูกข้ามเมื่อไม่มี MinIO | ตั้ง `S3_E2E=1` หลังเปิด MinIO | `e2e/run-local.sh` |
| GitHub Actions `startup_failure` | ตั้งแต่ปลายกันยายน 2026 workflow ไม่มี job เริ่มได้ และถูกปิดถาวร 2026-10-20 | `docs/plans/starter-249-bonus-month-promotion-plan.md`, `docs/plans/ops-followups-2026-10-23-plan.md` |

### 4.3 CI workflow ใน `.github/workflows` (17 ไฟล์)

สถานะตอนปิด: ไม่มี workflow ใดถูกใช้ตั้งแต่ 2026-10-20; ทุก release หลังจากนั้นบันทึก workflow ID เป็น `NOT_DISPATCHED` รายการด้านล่างคือสิ่งที่แต่ละ workflow ตรวจตามโค้ด

| Workflow | Trigger | สิ่งที่ gate |
|---|---|---|
| `ci.yml` (CI) | `pull_request` เข้า `main`/`develop`, `workflow_dispatch`, `workflow_call` | `resolve-source` (ตรวจ pin นโยบาย maintenance, ตัดสินว่าใช้ผล CI เดิมซ้ำได้หรือไม่); `typecheck-and-test` (ทดสอบตัวควบคุม Kamal/AgentCore, release recovery กับ PostgreSQL, build artifact AgentCore); `typecheck` (+ `check-di-metadata.mjs`); `unit-tests` แบ่ง 8 shard รัน `pnpm test`; `acceptance` (profile/billing, `pnpm test:harness`, LINE whole-chain, `test:m01`, `test:p1`); `release-contracts` (`production-image-security.spec.sh`, legal gate, maintenance controls, LINE AI release identity, A5 health); `security-audit`; `secret-scan`; `docker-build` (build image, `verify-production-image.sh`, SBOM); `config-validation` (`pnpm config:validate`, `runtime-alarms.spec.sh`); `migration-review` (`prisma:validate`, `migration:review`, spec PostgreSQL, `test:boot`); `publish-production-images`, `publish-production-manifest`, `publish-release-tools`, `publish-release-tools-manifest` (push ECR, `verify-ecr-scan.sh`, เซ็นและตรวจ image, SBOM) |
| `extended-tests.yml` | `workflow_dispatch` | `postgres-integration` (identity, username, LINE signup, support request, P27, OCR, expense payment integrity, reimbursement proof); `billing-integration` matrix `backend`/`customer`/`operations` (HTTP smoke + เบราว์เซอร์จริงกับ PostgreSQL แยก) |
| `deploy-uat.yml` | `workflow_dispatch` | แก้ release ref, ตรวจ environment UAT, build/test/publish image ไม่เปลี่ยนรูป, deploy UAT, ออก signed Passport |
| `production-readiness.yml` | `workflow_run` หลัง UAT, `workflow_dispatch`, `workflow_call` | ค้นหา Passport ที่ใช้ได้, stage candidate แยก, พิสูจน์ความพร้อม production และออก READY ที่เซ็นแล้ว |
| `deploy-production-v2.yml` | `workflow_dispatch` | พิสูจน์ READY ภายใน run แล้ว promote Passport ของ UAT ตัวเดิม (ไม่ rebuild) |
| `deploy-production.yml` | `workflow_dispatch` | เส้นทาง V1 เดิม (resolve → test/publish → deploy) ถูกปิดหลังย้ายเป็น Kamal |
| `recover-release-intent.yml` | `workflow_dispatch` | กู้ intent ของ release ที่ค้างแบบตรงตัว |
| `production-a5.yml`, `production-a5-clone.yml`, `production-a5-reader-bootstrap.yml` | `workflow_dispatch` | หลักฐาน A5 แบบอ่านอย่างเดียว, ซ้อม migration บน clone แยก, สร้างผู้อ่าน A5 |
| `production-security-preflight.yml` | `workflow_dispatch` | preflight ความปลอดภัย production แบบอ่านอย่างเดียว (branch protection, environment policy) |
| `a5-capacity-uat.yml` | `workflow_dispatch` | หลักฐานความจุ U5-C บน UAT |
| `u5-owner-approval.yml`, `u5-shadow-evidence.yml` | `workflow_dispatch` | เซ็นอำนาจของเจ้าของต่อ attempt, รวมและเซ็นหลักฐาน shadow |
| `f2-normalize.yml`, `f2-normalize-apply.yml` | `workflow_dispatch` | วางแผนและ apply การ normalize entitlement (F2) |
| `system-admin-cutover.yml` | `workflow_dispatch` | เปลี่ยนผู้ดูแลระบบ production จากบัญชี seed เป็นบัญชีจริงภายใต้ข้อจำกัด |

---

## 5. Quality gate, review checklist, นิยามของเสร็จ และหลักฐาน

### 5.1 Workflow มาตรฐาน (`AGENTS.md`)

1. Discover — อ่าน docs, โค้ด, contract, config, test และ checklist ที่เกี่ยว
2. Plan — การแก้ที่เล็กที่สุดซึ่งถูกต้องบนสถาปัตยกรรมเดิม
3. Execute
4. Verify — อย่างน้อยหนึ่งการตรวจเฉพาะจุดสำหรับ logic ที่ไม่เล็ก
5. Update — docs, plan, checklist, task memory เมื่อขอบเขต/สถานะเปลี่ยน
6. หยุดเมื่อหลักฐานการตรวจและสถานะถัดไปชัด

### 5.2 Review checklist (คัดจาก `AGENTS.md` ครบทุกข้อ)

- [ ] เป้าหมายผลิตภัณฑ์, ผู้ใช้, journey หลัก, กฎ/ข้อยกเว้น และ acceptance criteria ชัดใน spec, plan, memory หรือ handoff
- [ ] ความเข้ากับสถาปัตยกรรม, contract, ผลต่อ data model, permission/ABAC, state transition และขอบเขตชัด
- [ ] ใช้ diff ที่เล็กที่สุดซึ่งถูกต้อง; ไฟล์ที่แตะอยู่ในขอบเขต
- [ ] contract backend→frontend, journey ของ UI, สถานะ loading/error/permission และเส้นทาง E2E/เบราว์เซอร์ถูกตรวจเมื่อมี
- [ ] `docs/agent-memory/<task>.md` ถูกอัปเดตเมื่องานข้ามหลายรอบ/หลายโมดูล หรือแก้ docs กับโค้ดพร้อมกัน
- [ ] คำสั่งตรวจและผลถูกบันทึก หรือบันทึกเหตุผลที่ไม่ได้รันอย่างตรงตัว

### 5.3 Gate ที่ใช้จริงตอนปิด

| Gate | เนื้อหา | ผลที่ถือว่าผ่าน |
|---|---|---|
| Local merge gate | `scripts/local-proof/gate.sh`: (1) migrate + regenerate client + rebuild trial API (2) suite ทั้งหมด: contracts, web, API, harness, LINE whole-chain, AI gateway, typecheck สองตัว, pin check (3) spec กับฐานข้อมูลจริง (4) proof stack: build, ล้าง+seed, รัน journey ทุกตัว | บรรทัดสุดท้าย `GATE GREEN` และ exit 0; `GATE RED (<stage>)` หยุดที่ stage แรกที่ล้ม |
| กดเองหนึ่งครั้ง | ผู้ควบคุมกด journey ที่การแก้นั้นสังกัดบน proof stack | บันทึกว่ากดอะไร |
| Release prepare | `infra/kamal/deploy-uat --prepare` build TypeScript + image ทั้งสี่ + AgentCore และตรวจ config ครบ | `PREPARED_NO_DEPLOYMENT` |
| UAT apply | 12 phase รวม readiness ของ api-web/db, ai-gateway, workers/redis | `ACCEPTED_LINE_DEFERRED` เซ็นด้วย KMS |
| Production acceptance | เจ้าของล็อกอินเอง, `auth/me` 200 เป็น SYSTEM_ADMIN, platform access `OPEN`, logout แล้ว 401 | หลักฐาน JSON ใน run directory |
| Pin check | `sync-production-maintenance-release-pins.mjs --check`, fingerprint ของ LINE help pack, capability manifest | ไม่มี drift |

บทเรียนที่ถูกทำเป็นกติกา: อ่านทุกบรรทัด `RED` ของ summary ไม่ใช่แค่ท้ายไฟล์; ตรวจจำนวน test ที่รันจริง (ตัวแปร shell ที่ไม่ถูกแตกคำทำให้ไฟล์ถูกข้ามเงียบ ๆ); ทุก stage ไม่มี timeout ของตัวเอง ถ้าค้างต้องอ่าน `.summary`

### 5.4 นิยามของ "เสร็จ" (Definition of Done)

1. มี spec และ plan ก่อนลงมือสำหรับฟีเจอร์หลัก (docs-first)
2. โค้ดผ่าน typecheck ของแพ็กเกจที่แตะ และ spec ที่เกี่ยวถูกลงทะเบียนในสคริปต์
3. ฟีเจอร์ที่ขายมี journey test ของตัวเองก่อนเรียกว่าเสร็จ
4. merge gate เขียว และมีการกดหน้าจอจริงบน proof stack
5. task memory บันทึกคำสั่งตรวจและผล หรือเหตุผลที่ไม่ได้รัน
6. สำหรับ release: UAT เซ็นแล้ว, เจ้าของให้ "go" ชัดเจนก่อน production, production ผ่าน browser acceptance และ `OPEN`
7. ข้อความบนจอเป็นจริงทุกกรณี และการปฏิเสธมีทางออกให้ผู้ใช้เสมอ (หลักที่ใช้ review UX)

### 5.5 Manual UAT

| เอกสาร | เนื้อหา |
|---|---|
| `docs/qa/WatchDog-BMS_Manual_QA_Test_Plan_2026-07-09.xlsx` | แผนทดสอบมือฉบับแรก |
| `docs/qa/manual-test-playbook-2026-08.html` | playbook ทดสอบมือ |
| `docs/qa/tennis-shop-e2e-test-cases-2026-07-29.md` / `.xlsx`, `build_tennis_shop_test_workbook.py` | กรณีทดสอบร้านเทนนิสตั้งแต่ต้นจนจบ |
| `e2e/TEST-CASES.md`, `e2e/RESULTS.md`, `e2e/RESPONSIVE-RESULTS*.md`, `e2e/HANDOFF*.md` | รายการกรณีทดสอบ E2E, ผล และบันทึกส่งต่อ |
| `docs/qa/mangmee-conversation-acceptance-catalog-2026-09-26-th.md` | catalog การยอมรับบทสนทนา LINE AI |
| `docs/qa/*-e2e-simulation-*.md` | การจำลอง E2E ของ executive, manual expense flag, โปรโมชัน Starter 249 |

### 5.6 ที่เก็บหลักฐาน

| ที่อยู่ | เนื้อหา |
|---|---|
| `docs/qa/` | แผนทดสอบมือ, audit (`production-readiness-audit-*-2026-08-09.md`, `date-time-handling-audit-2026-08-06.md`, `system-error-message-audit-2026-09-21.md`, `starter-fixes-regression-2026-09-11.md`, `main-starter-web-qa-2026-09-11.md`), `line-ai-expense-advisor-eval.md` |
| `docs/qa/evidence/` | `ai-budget-split-2026-09-17`, `base-image-trixie-ab-*-2026-09-19.md`, `expense-*-2026-09-11`, `kamal-cold-cache-2026-09-12`, `kamal-stability-2026-09-11`, `line-ai-credit-holds-2026-09-18` |
| `docs/evidence/` | 90+ ชุดหลักฐานราย feature/release: billing (`billing-*-2026-09-*`, `stripe-*`), Postmark, UAT (`uat-*-2026-09-16*`), release (`release-2026-10-04`, `production-two-hotfixes-2026-09-18.md`), Kamal (`kamal-prod-*-2026-09-13`), LINE OA (`line-system-oa-*`, `line-official-oa-*`), router replay ของ advisor (`*-router-replays.json`), Halloween, homepage, P24/P27 |
| `docs/security-evidence/` | ROPA, ทะเบียน processor/ข้ามพรมแดน, การประเมิน DPO, ทะเบียน retention/การลบ, `legal-release-evidence.json` (สถานะ `BLOCKED`), หลักฐาน M-14 |
| `release-evidence/manifest.md` | Release manifest ของ Controlled Beta (สถานะ DRAFT; RC เริ่ม `773651a6`, 2026-08-26) |
| `docs/deliverables/iso29110-2026-09-06/evidence/` | หลักฐานประกอบชุดส่งมอบ ISO 29110 |
| `outputs/` | ผลลัพธ์ที่สร้างจากสคริปต์ (เช่น `outputs/mobile-evidence/EVIDENCE.md`) |
| นอก git | run directory ของ Kamal `.env.kamal/<env>/runs/<operation-id>/` (`result.json`, `accepted.json` ที่เซ็นแล้ว), `.local-proof/results/` — อยู่ในสำเนาสำรองของเจ้าของ ไม่อยู่ใน repo |

---

## 6. ผลคุณภาพ AI ที่บันทึกไว้

### 6.1 โปรแกรม Expense Advisor (กันยายน 2026) — `docs/agent-memory/mangmee-ai-expense-advisor-2026-09-27.md`

โมเดล: Bedrock global Sonnet 4.6 ด้วย environment AI ของ production; ชุดจูน 223 turn, ชุด held-out 71 turn

| รอบ (วันที่) | อัตราผ่าน |
|---|---|
| ชุดจูน รอบ 1–4 (2026-09-27) | 39.0% → 55.6% → 65.5% (76.2% หลังแก้ scorer/corpus) → 83.4% |
| ชุดจูน รอบ 6–10 (2026-09-28) | 96.9%, 94.6%, 96.9%, 97.3%, **97.3% (217/223)** บน commit `47f46dfb` |
| Held-out รอบ 2–3 (2026-09-28) | 90.1% → **91.5% (65/71)** |

| เกณฑ์ (รอบ 10 ชุดจูน / รอบ 3 held-out) | ผล |
|---|---|
| A2 / A3 | 98.2% / 95.7% — held-out 95.8% / 82.1% (เป้า A3 90: ไม่ถึง) |
| A4, A6, A8 | 0, 0, 0/0 — held-out A6 = 1 (เป้า 0: ไม่ถึง) |
| เวลา fast lane p50 / p95 | 5.4 s / 6.8 s — held-out 5.6 s / 7.9 s |
| เวลา full path p95 | 16.5 s — held-out 15.2 s (เป้า 15.0: ไม่ถึง) |
| ต้นทุนต่อ turn | ต่ำสุด 0.39 / เฉลี่ย **0.65** / สูงสุด 2.26 บาท (fast 0.51, full 0.99) — held-out เฉลี่ย 0.60 บาท |

ผู้ควบคุมตัดสิน merge พร้อมช่องว่างที่บันทึกใน spec §13 และแจ้งเจ้าของ 2026-09-28

### 6.2 โปรแกรม Workflow-first (พฤศจิกายน 2026) — `docs/research/line-ai-workflow-baseline-2026-10.md`

เกณฑ์วัดนิยามใน `docs/specs/line-ai-measurement-and-eval-spec.md` (W1 จัดประเภทถูก, W2 เริ่ม workflow ถูก, W3 จบงานโดยไม่ตัน, W6 เขียนผิด, W9 ผลจัดประเภทไม่ถูกรูป, W11 advisor ไม่ถดถอย, W14 classifier timeout; ประตู MA3 ต้องได้ W1/W2/W3 ≥ 95%)

| การวัด (วันที่, commit ของ main) | ผลหลัก |
|---|---|
| Baseline M4 (11-05/06, `efd65cbf5`) | W2 12/79 จูน, 40/240 held-out; W3 39/72 (54.2%) จูน, 59/160 (36.9%) held-out; advisor held-out 64/71 (90.1%), p95 5.5 s fast / 11.9 s full |
| หลัง Phase B (11-06) | W1 55/58 (94.8%) จูน, 74/92 (80.4%) held-out; W3 40/72; advisor 52/71 (73.2%) — ไม่ผ่าน |
| รอบ 8–9 (11-06) | W3 จูน 56/72 (77.8%); advisor 60/71 (84.5%) |
| รอบ 10 + blind gate แรก (11-06) | W3 จูน 65/72 (90.3%); blind W3 85/156 (54.5%) — ไม่ผ่าน; advisor 57/71 (80.3%) |
| รอบ 11–12 + blind v3 (11-06) | W3 จูน 65/69 (94.2%); blind W3 81/164 (49.4%), 98/164 หลังแก้ gold; advisor 59/71 (83.1%) |
| Blind v4 (11-07, `cc055ca42`, 225.18 บาท) | W3 workflow 53/119 (44.5%) |
| Blind v5 (11-07, `d8c6d10fd`, 167.33 บาท) | W3 workflow 111/169 (65.7%); W7 median 1 call ต่องาน |
| Blind v6 (11-07) | W3 workflow 82/147 (55.8%) |
| Blind v7 / v8 (11-07/08) | W3 workflow 101/122 (82.8%) / 126/151 (83.4%); advisor 126/142 (88.7%) / 170/177 (96.0%) |
| Blind v9 (11-08) | W3 workflow 123/176 (69.9%); ทุกงาน 229/294 (77.9%) |
| Blind v10 (11-08) | W3 workflow 171/204 (83.8%); ทุกงาน 249/285 (87.4%); W1 157/173 (90.8%) |
| Blind v11 (11-08, `787677daf`, 122.86 บาท) | W3 workflow 172/189 (91.0%); advisor 43/43; ทุกงาน 215/232 (92.7%) |
| Blind v12 (11-08, `bc68eb128`, 142.37 บาท) | W3 workflow 148/190 (77.9%) |
| Blind v13 (11-08, `d3f33d194`, 138.44 บาท) | workflow 198/204 (97.1%); W1 340/398 (85.4%), 91.2% หลังแก้ scorer; W6 เขียนผิด 0 |
| **Blind v14 — ข้อสอบเต็มชุดสุดท้าย** (11-08, `df0b45a30`, 228.17 บาท, API key ของเจ้าของ) | workflow 156/181 (86.2%), 162/181 (89.5%) หลังแก้ gold; W1 448/484 (92.6%); W2 172/181; เขียนผิด 0 หลังแก้ gold; W14 timeout 1/75 — **ไม่ผ่านกติกา** ณ ตอนรัน |
| ตรวจซ้ำเฉพาะจุดหลัง v14 (รอบ 23, 23b, 23c; 111.87 + 9.75 + 5.13 บาท) | คาดการณ์ v14 บนรอบ 23c: workflow **175/181 (96.7%)**, เขียนผิด 0, ข้อความ "ลองใหม่" 0 → **กติกา go/no-go ของเจ้าของผ่าน** (เป็นการคาดการณ์จากการตรวจซ้ำ ไม่ใช่การรันเต็มครั้งเดียว) |
| รอบ 24c (11-09) — ลอง classifier Haiku | v14 รันซ้ำ: workflow 180/181 หลังแก้ gold, เขียนผิด 0; classifier p50 2.6 → 1.4 s แต่ label ต่างจาก Sonnet 11 จาก 70 turn และ Sonnet ถูกทุกครั้ง → `LINE_CLASSIFY_MODEL_ID` กลับเป็น Sonnet 4.6 (`apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts` บรรทัด 81; `docs/specs/line-ai-workflow-first-spec.md`) |

กติกา go/no-go ของ v14 ที่เจ้าของตั้งไว้ล่วงหน้า: งาน workflow ≥ 95%, ไม่มีการเขียนผิด, ไม่มีข้อความ "ลองส่งข้อความเดิม" ค่าใช้จ่าย eval สะสมถึง baseline คือ 821 บาท ภายในเพดาน 2,300 บาท (เพดานถูกขยายภายหลัง ตัวเลขสุดท้ายไม่อยู่ในเอกสารของ checkout นี้)

### 6.3 ต้นทุน AI ใน production ที่อ่านจริง (`docs/runbooks/cloud-environment-operations.md`, บันทึก 2026-10-05)

กันยายน 2026: 557 เหตุการณ์ AI ตามเวลาไทย รวม 523.08 บาท จาก 30 บริษัท; ค่า model inference ของ Claude ทั้งบัญชี 154.86 USD (ต้นทุน token ที่ระบบบันทึก 15.61 USD ไม่ลงรอยกับยอดบัญชี — สาเหตุของส่วนต่างยังไม่ได้ข้อสรุป)

### 6.4 เวลาตอบบนระบบจริง

Baseline บนระบบ hosted อยู่ที่ `docs/agent-memory/line-ai-hosted-baseline-2026-09-03.md` และหลักฐาน latency ที่ `docs/agent-memory/line-ai-text-latency-evidence-2026-09-27.md`; รอบ 25–28 (2026-11-09) ลด `LINE_AI_BUFFER_DEBOUNCE_MS` จาก 1000 เป็น 500 เวลาตอบบน Anthropic API ไม่แทนเวลาบน Bedrock ของ production — ยังไม่มีการวัดเต็มบน UAT หลังรอบ 23c

---

## 7. ข้อบกพร่องและเรื่องค้างที่บันทึกไว้ตอนปิด

| # | เรื่อง | สถานะตอนปิด | แหล่ง |
|---|---|---|---|
| D-01 | spec สองไฟล์ที่รู้ว่าล้มและถูกยกเว้นจาก suite (`thai-date.logic`, `object-version-cleanup-internal.controller`) | เปิด — ต้องตัดสินว่ารูปแบบ CSV ที่เปลี่ยนเป็นไปโดยตั้งใจหรือไม่ | `spec-suite-coverage.spec.ts` |
| D-02 | LINE AI: นักบัญชีขอใบรับรองของสมาชิกอื่นได้ตัวเลือกแทนการปฏิเสธ (2 งาน); คำเลื่อนงาน "ยังไม่ทำ…"/"ไว้ทีหลัง" ชนกับเส้นปฏิเสธ (3 งาน); การ reject ใบเบิกหนึ่งกรณีจบแบบทางตัน | เปิด | baseline doc ส่วน "Still open" |
| D-03 | LINE AI: router ทิ้งชื่อบุคคลแล้วอ่านคิวอนุมัติของผู้ถาม (1 บทสนทนา) | เปิด | เอกสารเดียวกัน |
| D-04 | LINE AI advisor: ~81% หลัง v14; 17 กรณีคำถามต่อเนื่องเรื่องใบเบิกยังส่งไปหน้าเว็บ | เปิด | เอกสารเดียวกัน |
| D-05 | เวลาตอบ full path p95 เกิน 15 s (16.5 s จูน / 15.2 s held-out) | เปิดตั้งแต่ 2026-09-28 | advisor memory |
| D-06 | โควตา Bedrock: Sonnet 4.6 = 10 request/นาที, Haiku 5.5 = 0 token/นาที; เปิด case ขอเพิ่ม 2026-11-09 ยังไม่มีผล | เปิด — หมดความหมายเมื่อปิดบัญชี | cloud runbook |
| D-07 | Journey "บันทึกด้วยมือ" พลาดครั้งแรกจากการรอ first-visit | เปิด (ไม่นิ่ง) | security-fix-plan memory |
| D-08 | `User_username_lower_idx` ยังไม่เป็น UNIQUE; รอแก้ writer ที่เก็บตัวพิมพ์ใหญ่และตรวจ production | เปิด | `docs/runbooks/username-case-uniqueness-followup.md` |
| D-09 | เอกสารกฎหมายสำหรับ release: `legal-release-evidence.json` เป็น `BLOCKED`; production เปิดด้วย owner override | เปิด | `docs/runbooks/legal-release-evidence-bundle.md` |
| D-10 | สิทธิ์ของเจ้าของข้อมูล (PDPA): การลบจริง, การ replay หลัง restore และการอนุมัติภายนอกยังเป็นการควบคุมด้วยมือ | เปิด — release blocker ที่บันทึกไว้ | `docs/runbooks/user-company-data-rights.md` |
| D-11 | การออกเอกสาร billing ใหม่ (reissue) ไม่ได้สร้าง; ใช้วิธีแก้ด้วยมือ | เปิด | `docs/runbooks/billing-document-correction-manual.md` |
| D-12 | Kamal release path ไม่มี ECR scan gate (เจ้าของตัดสิน 2026-09-19 ให้สแกนเองเป็นรอบ) | ยอมรับความเสี่ยง | cloud runbook §ECR scan gate |
| D-13 | Alarm ความปลอดภัยของ API ค้างจากอีเมล `auth.email.security_notice` สถานะ DEAD ตั้งแต่ 2026-09-25 | ยอมรับด้วยข้อยกเว้นของเจ้าของ 2026-10-09 | cloud runbook |
| D-14 | แผนแก้ความปลอดภัย 2026-10-21 และ ops follow-up 2026-10-23: ลงโค้ดบางส่วน ส่วนที่ต้องทำบน cloud ยังเป็น PLANNED | เปิดบางส่วน | `docs/agent-memory/security-fix-plan-2026-10-21.md`, `docs/plans/ops-followups-2026-10-23-plan.md` |
| D-15 | Backlog 26 รายการของงานรายจ่าย (spec ขั้น 1–11 รับแล้ว 2026-11-04, การลงมือทำบางขั้นยังไม่จบ) | เปิด | `docs/agent-memory/expense-goal-program-2026-10-26.md` |
| D-16 | ไฟล์ spec ที่ไม่มีผู้รันใดระบุชื่อ: `ai-gateway` 1, `workers` 2, `contracts` 3 และ spec ใต้ `scripts/` 10 ไฟล์ กับอีก 4 ไฟล์ที่รันด้วยมือ (หัวข้อ 2.8); แพ็กเกจเหล่านี้ไม่มีตัวบังคับแบบ API | เปิด — ความเสี่ยงของ coverage | หัวข้อ 1.1, 2.8 |
| D-17 | CI บน GitHub ใช้ไม่ได้ตั้งแต่ปลายกันยายน 2026 และถูกปิด; workflow ไม่ได้ถูกพิสูจน์กับโค้ดช่วงตุลาคม–พฤศจิกายน | เปิด — ทีมใหม่ต้องพิสูจน์ใหม่ก่อนพึ่ง | หัวข้อ 4.2 |

---

## 8. ข้อกำหนดเชิงคุณภาพ (NFR) ที่เอกสารนี้นิยาม

ใช้ช่วงเลข 700 สำหรับเอกสาร 07 เพื่อไม่ชนกับเอกสารอื่น

| ID | ชื่อ | เกณฑ์ | การตรวจ |
|---|---|---|---|
| NFR-701 | ไฟล์ spec ทุกไฟล์ต้องถูกรันโดย runner ที่มีเจ้าของ | ไม่มี orphan ใต้ `apps/api/src` | `spec-suite-coverage.spec.ts` |
| NFR-702 | Merge gate ต้องเขียวก่อนงานถึงมือเจ้าของ | `GATE GREEN` | `scripts/local-proof/gate.sh` |
| NFR-703 | ฟีเจอร์ที่ขายต้องมี journey test | มีไฟล์ใน `e2e/journeys/` ต่อ journey | หัวข้อ 2.6 |
| NFR-704 | หน้าจอต้องใช้ได้ที่ 375 px และไม่ล้นบนจอกว้าง | project `mobile-375`, `journeys-mobile`, `desktop-*` | `e2e/responsive.spec.ts`, `evidence.spec.ts` |
| NFR-705 | LINE AI: งาน workflow ≥ 95%, เขียนผิด 0, ไม่มีข้อความ "ลองส่งข้อความเดิม" | กติกา v14 | eval harness |
| NFR-706 | LINE AI advisor: A2 ≥ 90%, full path p95 ≤ 15 s | spec advisor §10 | eval harness |
| NFR-707 | Config ของ production ต้องผ่านตัวตรวจก่อน deploy | ไม่มี error จาก `validateProductionConfig` | `pnpm config:validate`, `infra/dev-kamal/verify-config.mjs` |
| NFR-708 | ไม่มี dependency ที่มีช่องโหว่ระดับ high ขึ้นไป | `pnpm audit --audit-level=high` ผ่าน | `pnpm security:audit` |
| NFR-709 | การทดสอบกับฐานข้อมูลจริงต้องชี้ localhost เท่านั้น | guard ปฏิเสธ host อื่น | `pg-spec-guard.ts`, `scripts/local-proof/common.sh` |
| NFR-710 | Contract ร่วมต้องตรงกับ Prisma enum และ registry สิทธิ์ | spec parity ผ่าน | `prisma-enum-parity.spec.ts`, `permission-registry.spec.ts`, `agent-tools.parity.spec.ts` |
| NFR-711 | ข้อมูลทดสอบและหลักฐานต้องไม่มี secret หรือข้อมูลลูกค้าจริง | ไม่มีใน git | secret scan ของ `ci.yml`, นโยบายหัวข้อ 3.4 |

---

## 9. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

เอกสารนี้ไม่ได้ตัดสินว่าฟีเจอร์ใดอยู่ใน preset ของแพ็ก (ดูเอกสารฟีเจอร์ที่อ่านจาก `TIER_FEATURE_PRESETS`) บันทึก `docs/agent-memory/mangmee-ai-expense-advisor-2026-09-27.md` ระบุว่าแพ็กที่ขายคือรายจ่าย + ใบเบิก และ ENTERPRISE เพิ่ม ภ.ง.ด.53/50 ทวิ ส่วน "เอกสารขายและรายงานไม่ได้ขาย" ชุดทดสอบต่อไปนี้จึงครอบคลุมโมดูลที่มีโค้ดแต่ไม่อยู่ในสิ่งที่ขาย และไม่ได้ลงรายละเอียดในเอกสารนี้:

- `banking` — API 7 ไฟล์, web 1, `e2e/banking.spec.ts`
- `inventory` — API 2, web 2, `e2e/inventory.spec.ts`
- `procurement` — API 19, web 1, `e2e/procurement.spec.ts`
- `reports` / `executive-business` / `executive-reports` — API 6 + 3, web 1 + 10 + 2, `e2e/reports*.spec.ts`, `e2e/executive-report.spec.ts`
- `workflow` — API 17, web 1, `e2e/workflow.spec.ts`
- เอกสารขายใน `accounting-documents` และ ledger เต็มรูป — `e2e/accounting.spec.ts`, `e2e/journal.spec.ts`
- การจอง — `e2e/bookings.spec.ts`
- กิจกรรม Halloween (ตุลาคม 2026) — หลักฐานใน `docs/evidence/halloween-*`


---

## ภาคผนวก ก — รายชื่อไฟล์ทดสอบทุกไฟล์

สร้างจาก `git ls-files` ของ commit `08850deaf` จัดกลุ่มตามโฟลเดอร์ ชื่อไฟล์ตัดส่วนท้าย `.spec.ts` ออกเมื่อเป็นนามสกุลนั้น (ไฟล์ที่ลงท้ายอื่นแสดงชื่อเต็ม) ไฟล์ที่ชื่อลงท้าย `.pg` หรือ `.postgres` ต้องใช้ PostgreSQL จริง

### ก.1 `apps/api/src/modules/access-control` (3 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 2 | `permission-resolver`, `policies` |
| `domain/logic` | 1 | `plan-manager.logic` |

### ก.1 `apps/api/src/modules/accounting-documents` (23 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/services` | 1 | `revenue-category-bootstrap.service` |
| `application/use-cases` | 9 | `counterparty-registry.use-case`, `document-transaction-tax.use-case`, `ensure-vendor-counterparty-from-expense.use-case`, `issue-document-number-release.use-case`, `money-input-validation.use-case`, `revenue-category.use-case`, `sum-received-payments-by-counterparty.use-case`, `update-document.use-case`, `void-true-reversal.use-case` |
| `domain/logic` | 5 | `accounting-money-validation.logic`, `accounting-status.logic`, `accounting-totals.golden`, `accounting-totals.logic`, `vendor-counterparty-match.logic` |
| `infrastructure` | 7 | `counterparty-type-promotion`, `prisma-accounting.repository.atomic-issue`, `prisma-accounting.repository.conversion`, `prisma-accounting.repository.counterparty-usage`, `prisma-accounting.repository.draft-update`, `prisma-accounting.repository.related-access`, `prisma-accounting.repository.void` |
| `presentation/http` | 1 | `accounting-money.dtos` |

### ก.1 `apps/api/src/modules/ai-draft` (12 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application` | 1 | `source-state.service` |
| `application/use-cases` | 5 | `ai-suggestion-review.use-case`, `create-draft-request.use-case`, `drain-draft-requests.use-case`, `generate-suggestion.use-case`, `line-ai-suggestion.use-case` |
| `domain/logic` | 5 | `ai-draft-idempotency.logic`, `ai-draft-permission.logic`, `ai-draft-safety.logic`, `ai-draft-status.logic`, `line-ai-suggestion.logic` |
| `presentation/http` | 1 | `ai-draft-internal.controller` |

### ก.1 `apps/api/src/modules/audit` (3 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 1 | `audit.service` |
| `domain/logic` | 1 | `audit-actor.logic` |
| `infrastructure` | 1 | `prisma-audit.repository` |

### ก.1 `apps/api/src/modules/auth` (45 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 18 | `account-profile-email.pg`, `account-profile-username.pg`, `auth-endpoints`, `auth.guard`, `free-expense-handoff`, `free-expense-password-login`, `line-binding.pg`, `line-handoff`, `line-liff-signup`, `line-link-oauth`, `line-linking`, `line-login-callback`, `line-official-webhook.controller`, `line-recovery.pg`, `line-web-qr`, `line-webhook.controller`, `permission-registry`, `postmark-delivery.pg` |
| `application` | 5 | `account-email-otp.postgres`, `auth-rate-limit.service`, `email-access.pg`, `legal-acceptance.service`, `line-id-token.service` |
| `application/use-cases` | 8 | `account-merge.use-case`, `account-profile.use-case`, `complete-employee-line-link.use-case`, `forgot-password-reset.use-case`, `get-account-security-state.use-case`, `link-line-identity.use-case`, `notify-password-reset-request.use-case`, `refresh-session-reuse.use-case` |
| `domain/logic` | 5 | `email-otp.logic`, `line-handoff.logic`, `line-web-qr.logic`, `login-channel.logic`, `password-credential.logic` |
| `infrastructure` | 7 | `account-claim-email.template`, `demo-outbound`, `jwt-verifier-pinning`, `postmark-configuration`, `postmark.client`, `ses-auth-mailer.adapter`, `system-line-push` |
| `presentation` | 2 | `auth.controller`, `demo-chat-expiry` |

### ก.1 `apps/api/src/modules/banking` (7 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/use-cases` | 4 | `bank-account.use-case`, `matching.use-case`, `reconciliation.use-case`, `statement-import.use-case` |
| `domain/logic` | 1 | `banking.logic` |
| `infrastructure` | 1 | `prisma-match-source.query` |
| `presentation/http` | 1 | `banking.dtos` |

### ก.1 `apps/api/src/modules/billing` (64 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 19 | `billing-admin-tools.pg`, `billing-caps.pg`, `billing-cash-movements.pg`, `billing-event-discount-renewal.pg`, `billing-event-discount.pg`, `billing-grace.pg`, `billing-issue-resolution.pg`, `billing-issues.pg`, `billing-product-foundation.pg`, `billing-promotion-apply.pg`, `billing-promotion-campaigns.pg`, `billing-promotion-checkout.pg`, `billing-promotion.pg`, `billing-receipts.pg`, `billing-recipient-capture.pg`, `billing-settings.pg`, `billing-trial-carryover.pg`, `line-billing-entry`, `receipt-addon-ledger.pg` |
| `application` | 36 | `billing-addon-admin-grants`, `billing-admin-lookup`, `billing-advance-deal.pg`, `billing-approval`, `billing-capacity`, `billing-checkout-expiry-owner`, `billing-checkout-expiry-source`, `billing-collection`, `billing-company-profile`, `billing-deal-chat-credit`, `billing-deal-subscription-cancel`, `billing-document-admin.service`, `billing-document-resend`, `billing-email-recipient.postgres`, `billing-end-package`, `billing-event-discount`, `billing-feature-entitlements`, `billing-feature-entitlements.pg`, `billing-financial`, `billing-free-days`, `billing-notifications-recipient`, `billing-overview-pagination`, `billing-plan-manage`, `billing-plan-menus`, `billing-price-return`, `billing-profile-recovery`, `billing-purchase-source`, `billing-purchase-source.pg`, `billing-receipt-allocator`, `billing-recipient-otp.service`, `billing-reconcile-command`, `billing-refund-source`, `billing-restart`, `billing-schedule`, `billing-settlement-source`, `billing-upgrade` |
| `domain` | 8 | `billing-event-discount.logic`, `billing-package`, `billing-policy-addon`, `billing-promotion`, `billing-recipient-otp.logic`, `deal-offer`, `paid-checkout-invoice`, `paid-invoice-promptpay` |
| `infrastructure` | 1 | `stripe.client` |

### ก.1 `apps/api/src/modules/crm` (9 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/use-cases` | 3 | `crm-booking.use-case`, `crm-quotation.use-case`, `crm-workflow.use-case` |
| `domain/logic` | 4 | `crm-booking-availability.logic`, `crm-booking-proposal.logic`, `crm-booking.logic`, `crm.logic` |
| `infrastructure` | 2 | `prisma-crm-booking-proposal.repository`, `prisma-crm.repository` |

### ก.1 `apps/api/src/modules/crm-inbox` (43 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 2 | `crm-ai-separation`, `crm-receipt-separation` |
| `application/use-cases` | 22 | `create-from-conversation.use-case`, `crm-ai-assist.use-case`, `crm-ai-trust.use-case`, `crm-conversation.use-case`, `crm-customer-360.use-case`, `crm-customer-profile-assist.use-case`, `crm-daily-brief.use-case`, `crm-inbox-policy.use-case`, `crm-payment-proof.use-case`, `crm-pdpa-self-service.use-case`, `crm-pdpa.use-case`, `crm-reports-summary.use-case`, `crm-template.use-case`, `customer-line-register.use-case`, `deliver-crm-campaign.use-case`, `messaging-channel.use-case`, `process-inbound-line-message.use-case`, `retry-crm-inbox-deliveries.use-case`, `scan-crm-booking-reminders.use-case`, `scan-crm-new-conversations.use-case`, `scan-crm-sla-breaches.use-case`, `sweep-crm-booking-proposals.use-case` |
| `domain/logic` | 12 | `crm-ai-trust.logic`, `crm-auto-reply.logic`, `crm-autonomy-schema`, `crm-campaign-metrics.logic`, `crm-campaign.logic`, `crm-daily-brief.logic`, `crm-deferred-feature.logic`, `crm-inbox.logic`, `crm-pdpa-purge.logic`, `crm-reports.logic`, `mvp1-0-setup.logic`, `pdpa-audit-redaction.logic` |
| `infrastructure` | 5 | `crm-ai-gateway.client`, `line-messaging.adapter`, `prisma-crm-channel-cap.repository`, `prisma-crm-inbox.repository`, `prisma-crm-pdpa-self-service.repository` |
| `presentation/http` | 2 | `crm-line-webhook.controller`, `customer-line-register.controller` |

### ก.1 `apps/api/src/modules/dashboard-notifications` (10 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 1 | `dashboard-notification-correctness` |
| `application/providers` | 2 | `expense-summary.provider`, `inventory-health.provider` |
| `application/use-cases` | 3 | `generate-snapshot.use-case`, `notification-preference.use-case`, `process-due-deliveries.use-case` |
| `domain/logic` | 1 | `notification.logic` |
| `infrastructure` | 1 | `document-notification-state` |
| `presentation/http` | 2 | `dashboard-notifications.dtos`, `internal.controller` |

### ก.1 `apps/api/src/modules/data-model-core` (40 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/services` | 3 | `object-version-cleanup.service`, `outbox-append.service`, `transaction-branch` |
| `application/use-cases` | 14 | `company-identity.use-case`, `company-vat-registration.use-case`, `complete-attachment-upload.use-case`, `create-branch.use-case`, `create-download-url.use-case`, `create-upload-intent.use-case`, `delete-attachment.use-case`, `free-expense-attachment`, `link-attachment.use-case`, `list-branches.use-case`, `list-document-sequences.use-case`, `reserve-document-number.use-case`, `update-branch.use-case`, `upsert-document-sequence.use-case` |
| `domain/logic` | 10 | `attachment.logic`, `branch.logic`, `company-legal-identity.logic`, `company-tax-readiness.logic`, `company-vat-registration.logic`, `document-sequence.logic`, `identity-reconciliation.logic`, `object-version-inventory.logic`, `outbox.logic`, `p1-branch-authorization-matrix` |
| `infrastructure` | 2 | `attachment-malware-scanner`, `company-tax-identity-migration.pg` |
| `infrastructure/repositories` | 6 | `document-sequence-branch-collision`, `prisma-attachment.repository`, `prisma-branch.repository`, `prisma-document-sequence.repository`, `prisma-outbox.repository`, `prisma-outbox.repository.claim` |
| `infrastructure/storage` | 2 | `local-storage.adapter`, `s3-storage.adapter` |
| `presentation/http` | 3 | `company-business-type.controller`, `data-model-core.dtos`, `object-version-cleanup-internal.controller` |

### ก.1 `apps/api/src/modules/data-rights` (3 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 3 | `data-rights-single-admin.pg`, `data-rights.controller`, `data-rights.service` |

### ก.1 `apps/api/src/modules/employee-access` (19 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 1 | `create-employee-username.pg` |
| `application` | 2 | `entitlement.helper`, `normalize-entitlements` |
| `application/use-cases` | 10 | `business-policy.use-case`, `create-employee.use-case`, `create-role.use-case`, `employee-lifecycle.use-case`, `entitlement-exception.use-case`, `get-access-matrix.use-case`, `list-thai-addresses.use-case`, `regenerate-employee-credential.use-case`, `role-management.use-case`, `update-employee-branch-scope` |
| `domain/logic` | 6 | `capability.logic`, `employee-access.logic`, `feature-gate.logic`, `menu-entitlement-binding`, `role-template-read-coverage`, `role-template-system-role-parity` |

### ก.1 `apps/api/src/modules/executive-business` (3 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 3 | `executive-demo-classification`, `executive-report-build.pg`, `executive-report-read.pg` |

### ก.1 `apps/api/src/modules/expenses` (91 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 12 | `expense-capture-certificate.pg`, `expense-capture-compatibility`, `expense-capture-handoff.pg`, `expense-capture-lane-parity`, `expense-capture-read.pg`, `expense-capture.pg`, `expense-line-charge-kind.pg`, `expense-source-draft.pg`, `line-draft-update.pg`, `receipt-truth.pg`, `receipt-upload-source.pg`, `substitute-receipt-signature-queue.pg` |
| `application` | 1 | `expense-launch-gate` |
| `application/services` | 5 | `expense-capture-read-runner.service`, `expense-category-bootstrap.service`, `expense-duplicate-detection`, `expense-transaction-tax.service`, `receipt-ocr-apply.service` |
| `application/use-cases` | 31 | `delete-expense.use-case`, `expense-branch-scope.use-case`, `expense-capture-group.use-case`, `expense-capture-handoff.use-case`, `expense-capture-policy.use-case`, `expense-capture-read-status.use-case`, `expense-capture-review.use-case`, `expense-document.use-case`, `expense-draft-ai-missing-fields.use-case`, `expense-draft-amount-validation.use-case`, `expense-draft-concurrency.use-case`, `expense-draft-vat-decouple.use-case`, `expense-extraction.use-case`, `expense-free-access.use-case`, `expense-related-access.use-case`, `expense-upload.use-case`, `expense-vendor-address.use-case`, `expense-vendor-counterparty-autosave.use-case`, `line-correction.use-case`, `line-draft-update.security`, `line-expense-draft-conversation.use-case`, `line-substitute-receipt-continuation.use-case`, `record-expense-payment.use-case`, `remove-expense-receipt.use-case`, `substitute-receipt-capture.use-case`, `substitute-receipt-download.use-case`, `substitute-receipt-payer-access.use-case`, `substitute-receipt-policy.use-case`, `substitute-receipt-signature-queue.use-case`, `substitute-receipt.use-case`, `void-expense-true-reversal.use-case` |
| `domain/logic` | 25 | `buyer-as-printed.logic`, `expense-auto-post.logic`, `expense-capture-allocation.logic`, `expense-capture-assembly.logic`, `expense-capture-facts.logic`, `expense-capture-fields.logic`, `expense-capture-handoff.logic`, `expense-capture-policy.logic`, `expense-capture-preprocess.logic`, `expense-capture.logic`, `expense-document.logic`, `expense-draft-amount-validation.logic`, `expense-duplicate.logic`, `expense-export.logic`, `expense-source-draft.logic`, `expense-status.logic`, `expense-totals.logic`, `expense-vendor-identity.logic`, `line-correction.logic`, `line-draft-update.logic`, `line-expense-draft-conversation.logic`, `line-receipt-branch.logic`, `payment-voucher.logic`, `substitute-receipt-pdf.logic`, `substitute-receipt.logic` |
| `infrastructure` | 16 | `expense-capture-read.client`, `expense-evidence-sources`, `expense-number.pg`, `prisma-expense.repository.atomic-confirm`, `prisma-expense.repository.branch`, `prisma-expense.repository.duplicate-resolve`, `prisma-expense.repository.line-continuation`, `prisma-expense.repository.payment`, `prisma-expense.repository.posting-source`, `prisma-expense.repository.substitute-number`, `prisma-expense.repository.substitute-payment`, `prisma-expense.repository.tax-snapshot`, `prisma-expense.repository.vendor-address-filter`, `prisma-expense.repository.void`, `substitute-expense-edit.pg`, `substitute-funding.pg` |
| `presentation/http` | 1 | `expense.dtos` |

### ก.1 `apps/api/src/modules/external-signup` (30 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 4 | `line-signup-duplicate-email.pg`, `line-signup-stale-identity.pg`, `line-support-request.pg`, `signup-provisioning-recovery.pg` |
| `application` | 18 | `account-claim-token.service`, `line-signup-auto-free.integration`, `line-signup-notify.service`, `line-signup-status-and-package-change`, `provision-signup.plan-term.integration`, `provision-signup.use-case`, `public-signup-status.use-case`, `ses-event.use-case`, `signup-admin-notify.service`, `signup-admin-queue.use-case`, `signup-claim-email.service`, `signup-claim.use-case`, `signup-ops-alert.service`, `signup-replay-recovery`, `signup-suspend-race`, `submit-company-signup.use-case`, `submit-line-signup.use-case`, `support-request-admin.use-case` |
| `domain` | 4 | `account-claim.logic`, `business-hours.logic`, `company-signup.logic`, `line-signup.logic` |
| `infrastructure` | 1 | `sns-signature` |
| `presentation/http` | 3 | `public-company-signup.controller`, `public-line-signup.controller`, `system-signup-request.controller` |

### ก.1 `apps/api/src/modules/feature-launch` (17 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application` | 10 | `assert-specialist-routes-closed`, `execution-attempt.service`, `execution-attempt.service.race`, `launch-gate.guard`, `launch-shadow.probe`, `launch-shadow.probe.concurrency`, `retire-launch-builds`, `runoff-lifecycle`, `runoff-lifecycle.race`, `seed-launch-gates` |
| `application/use-cases` | 3 | `get-launch-health.use-case`, `launch-gate-command.use-case`, `launch-gate-command.use-case.race` |
| `domain` | 2 | `runoff-matrix.catalog`, `shadow-surface.catalog` |
| `domain/logic` | 1 | `launch-gate-snapshot.logic` |
| `presentation/http` | 1 | `launch-gate.controller` |

### ก.1 `apps/api/src/modules/health` (1 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 1 | `health` |

### ก.1 `apps/api/src/modules/inventory` (2 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `domain/logic` | 1 | `stock-movement.logic` |
| `presentation/http` | 1 | `inventory.dtos` |

### ก.1 `apps/api/src/modules/ledger` (27 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/services` | 3 | `chart-template-bootstrap.service`, `chart-template-query.service`, `chart-template.service` |
| `application/use-cases` | 14 | `account.use-case`, `claim-payment-posting.pg`, `expense-account-binding.use-case`, `expense-auto-post.use-case`, `expense-backfill.use-case`, `expense-payment-posting.use-case`, `journal-reversal-net-zero.use-case`, `journal-vat-invariant.use-case`, `manual-journal-invariants.use-case`, `payment-posting-source.use-case`, `period-chart-close.use-case`, `period-reimbursement-close.use-case`, `period-transaction-tax-close.use-case`, `template-company-posting.use-case` |
| `domain/logic` | 7 | `chart-template.logic`, `expense-account-binding.logic`, `journal-balance.logic`, `posting-date.logic`, `reimbursement-expense-posting.logic`, `transaction-tax-posting.logic`, `wht-payment-posting.logic` |
| `infrastructure` | 1 | `prisma-ledger.repository` |
| `presentation/http` | 2 | `expense-auto-post-internal.controller`, `ledger.dtos` |

### ก.1 `apps/api/src/modules/line-ai` (92 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 8 | `line-ai-capability-manifest`, `line-delivery-access.pg`, `line-delivery-plan.pg`, `line-first-signup-webhook`, `line-ledger-delivery.pg`, `line-read-evidence.pg`, `onboarding-receipt-allowance.pg`, `receipt-reliability.pg` |
| `application` | 29 | `ai-credit-cycles`, `ai-credit-demo`, `ai-credit-funding.pg`, `ai-fx-rate`, `ai-model-pricing`, `company-ai-budget-reservation`, `company-ai-budget-reservation.pg`, `company-ai-credit-holds.pg`, `company-ai-model-policy`, `company-ai-usage-meter`, `company-ocr-demo`, `free-expense-quota.pg`, `line-ai-budget-authority.pg`, `line-ai-consumption-marker`, `line-ai-ledger.service`, `line-capture-delivery.pg`, `line-conversation-context.pg`, `line-document-qa.pg`, `line-handoff-link.service`, `line-input-buffer.pg`, `line-ledger-accepted-request.pg`, `line-message-buffer.demo`, `line-message-buffer.service`, `line-pending-media.pg`, `line-read-evidence`, `line-reimbursement-draft-adapter.pg`, `line-reimbursement-draft.service`, `line-retained-task-source.pg`, `package-usage.pg` |
| `application/use-cases` | 31 | `company-list-branches.tool`, `drain-line-ledger.use-case`, `erp-banking-tools.use-case`, `erp-business-tools.use-case`, `erp-core-detail-tools.use-case`, `erp-crm-operational-tools.use-case`, `erp-crm-tools.use-case`, `erp-draft-update-tools.di`, `erp-empty-result-semantics`, `erp-expense-list-recent.use-case`, `erp-package-tools.use-case`, `erp-procurement-ledger-tools.use-case`, `erp-reimbursement-tools.use-case`, `erp-report-tools.use-case`, `erp-source-reliability.pg`, `erp-substitute-receipt-tools.use-case`, `erp-tax-tools.use-case`, `expense-explain-record.tool`, `line-ai-combined-regression`, `line-capture-branch-default`, `line-capture-result-notifier.use-case`, `line-intake-dispatch.use-case`, `line-public-general`, `process-line-document-qa.bridge`, `process-line-general-v2`, `process-line-mixed-business-v2`, `process-line-task-resume`, `process-line-webhook.demo-media`, `process-line-webhook.fixed-read`, `process-line-webhook.use-case`, `recover-orphan-line-events.use-case` |
| `domain/logic` | 16 | `free-expense-line.logic`, `line-advisor-direct-answer.logic`, `line-ai-classifier`, `line-ai-reconciliation.logic`, `line-ai-terminal-outcome.logic`, `line-business-card.logic`, `line-delivery-plan.logic`, `line-draft-update-card.logic`, `line-event-discount.logic`, `line-file-attempt-answer.logic`, `line-message-buffer.logic`, `line-non-receipt-reply.logic`, `line-preference-command.logic`, `line-reimbursement-draft-card.logic`, `line-staff-menu.logic`, `package-usage-pace.logic` |
| `infrastructure` | 6 | `actor-delegation.service`, `ai-gateway.client`, `line-intake-state.repository`, `line-reply.adapter`, `line-reply.demo`, `public-lookup` |
| `presentation/http` | 2 | `internal-ai-budget.controller`, `internal-tools.controller` |

### ก.1 `apps/api/src/modules/procurement` (19 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/use-cases` | 11 | `post-goods-receipt-atomic.use-case`, `pp36-input-claim.use-case`, `procurement-create-integrity.use-case`, `procurement-related-access.use-case`, `supplier-input-validation.use-case`, `supplier-payment-integrity.use-case`, `vendor-bill-integrity.use-case`, `vendor-bill-maker-checker.use-case`, `vendor-bill-transaction-tax.use-case`, `void-goods-receipt.use-case`, `void-vendor-bill.use-case` |
| `domain/logic` | 1 | `procurement.logic` |
| `infrastructure` | 5 | `goods-receipt-void-reversal.repository`, `pp36-payment-reversal.repository`, `prisma-procurement-integrity.repository`, `prisma-procurement-related.repository`, `vendor-bill-void-reversal.repository` |
| `presentation/http` | 2 | `pp36-input-claim.controller`, `procurement.dtos` |

### ก.1 `apps/api/src/modules/reimbursements` (25 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 1 | `line-reimbursement-draft.pg` |
| `application/services` | 3 | `materialize-claim-expenses.service`, `reimbursement-evidence.service`, `reimbursement-projection-reconciler.service` |
| `application/use-cases` | 11 | `line-reimbursement-draft.use-case`, `reimbursement-approval-backlog.use-case`, `reimbursement-approval.use-case`, `reimbursement-branch-scope.use-case`, `reimbursement-claim-form.use-case`, `reimbursement-claim-signature.use-case`, `reimbursement-finance.use-case`, `reimbursement-payment-posting.use-case`, `reimbursement-related-access.use-case`, `reimbursement-request.use-case`, `void-reimbursement-payment-reversal.use-case` |
| `domain` | 1 | `reimbursement.constants` |
| `domain/logic` | 2 | `claim-form.logic`, `reimbursement.logic` |
| `infrastructure` | 4 | `prisma-reimbursement.repository.atomic-lines`, `prisma-reimbursement.repository.draft-submit-race`, `prisma-reimbursement.repository.payment-mirror`, `reimbursement-source` |
| `presentation/http` | 3 | `reimbursement-draft-action.controller`, `reimbursement-write-quiesce.guard`, `reimbursement.dtos` |

### ก.1 `apps/api/src/modules/reports` (6 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application` | 3 | `report-entitlement.race`, `report-source-adapters`, `report.use-cases` |
| `domain` | 3 | `report-csv.logic`, `report-permission.logic`, `report-query-validator.logic` |

### ก.1 `apps/api/src/modules/sales-console` (10 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 3 | `claim-event-discount.pg`, `sales-console.pg`, `sales-event-discounts.pg` |
| `application` | 1 | `claim-event-discount.use-case` |
| `domain` | 6 | `sales-attribution.logic`, `sales-deal.logic`, `sales-event-claim.logic`, `sales-event-report.logic`, `sales-event.logic`, `sales-renewal.logic` |

### ก.1 `apps/api/src/modules/sales-demo` (8 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 1 | `sales-demo.pg` |
| `application` | 5 | `demo-chat`, `demo-company-access`, `demo-sample-data`, `demo-sample-data.pg`, `sales-demo.service` |
| `presentation` | 2 | `sales-demo-credit`, `sales-demo.controller` |

### ก.1 `apps/api/src/modules/system-identity-reconciliation` (1 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/use-cases` | 1 | `identity-reconciliation.use-cases` |

### ก.1 `apps/api/src/modules/system-onboarding` (4 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/use-cases` | 3 | `create-company-onboarding`, `regenerate-temporary-password.use-case`, `reissue-owner-line-link.use-case` |
| `presentation/http` | 1 | `system-onboarding.controller` |

### ก.1 `apps/api/src/modules/system-partner-management` (30 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 2 | `manual-expense-web-entry.pg`, `report-labels.pg` |
| `application` | 3 | `free-expense-access`, `free-expense-access.pg`, `partner-ai-adjustment-history` |
| `application/use-cases` | 18 | `company-plan-term.use-cases`, `get-partner-ai-usage.use-case`, `get-partner-detail.use-case`, `list-partners.use-case`, `lookup-users.use-case`, `package-change-decision.use-case`, `partner-ai-credit-holds.use-case`, `partner-lifecycle-transition.use-case`, `partner-member-console.use-cases`, `partner-member-line-link-token.use-case`, `plan-term-sweep.use-case`, `set-partner-ai-model.use-case`, `set-partner-features.use-case`, `set-partner-line-credential.use-case`, `set-platform-ai-budget.use-case`, `set-shared-line-credential.use-case`, `update-partner-identity.use-case`, `update-partner-profile.use-case` |
| `domain/logic` | 5 | `credential-cipher.logic`, `partner-line-message.logic`, `plan-capacity`, `plan-term.logic`, `receipt-quota.logic` |
| `presentation/http` | 2 | `partner-support-tools`, `partner.controller` |

### ก.1 `apps/api/src/modules/tax` (35 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/use-cases` | 17 | `correct-wht-certificate.use-case`, `create-wht-certificate.use-case`, `generate-tax-filing-package.use-case`, `issue-wht-certificate-from-handoff.use-case`, `issue-wht-replacement-copy.use-case`, `sync-tax-events-components.use-case`, `sync-tax-events-output-code.use-case`, `sync-tax-events-payee-address.use-case`, `sync-tax-events-supplier-payment-wht.use-case`, `sync-tax-events-vat-invariant.use-case`, `sync-tax-events-wht-form.use-case`, `tax-code-import.use-case`, `transaction-tax-config.use-case`, `transaction-tax-reconciliation.use-case`, `update-company-tax-signature.use-case`, `wht-certificate-handoff.use-case`, `wht-income-category.use-case` |
| `domain` | 1 | `tax-code-template.catalog` |
| `domain/logic` | 10 | `tax-configuration.logic`, `tax-evidence-policy.logic`, `tax-export.logic`, `tax-period.logic`, `tax-reconciliation.logic`, `tax-reviewer.logic`, `transaction-tax.logic`, `vat-report.logic`, `wht-certificate-pdf.logic`, `wht-report.logic` |
| `infrastructure/adapters` | 2 | `expense-source.adapter`, `supplier-payment-source.adapter` |
| `infrastructure/repositories` | 2 | `prisma-tax.repository`, `prisma-transaction-tax.repository` |
| `presentation/http` | 3 | `tax.controller`, `transaction-tax.controller`, `transaction-tax.dtos` |

### ก.1 `apps/api/src/modules/workflow` (17 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `application/use-cases` | 9 | `workflow-action-runner.use-case`, `workflow-event-ingest.use-case`, `workflow-outbox-drain.use-case`, `workflow-retry.use-case`, `workflow-runner.use-case`, `workflow-scan.use-case`, `workflow-task.use-case`, `workflow-template-auto-enable`, `workflow-template.use-case` |
| `domain/logic` | 7 | `workflow-action.logic`, `workflow-condition.logic`, `workflow-event-match.logic`, `workflow-idempotency.logic`, `workflow-permission.logic`, `workflow-render.logic`, `workflow-webhook-security.logic` |
| `presentation/http` | 1 | `workflow-internal.controller` |

### ก.2 `apps/api` นอก `modules` (39 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `prisma` | 8 | `bootstrap-a5-readonly`, `run-exclusive-release-operation`, `seed-attachment-storage`, `sync-permissions`, `system-admin-cutover.pg`, `verify-applied-migration-catalog`, `verify-feature-launch-build-authority`, `verify-production-ready-migration` |
| `prisma/production-a5` | 2 | `run-clone-rehearsal`, `run-production-apply` |
| `src` | 1 | `spec-suite-coverage` |
| `src/common/export` | 1 | `thai-date.logic` |
| `src/common/filters` | 1 | `all-exceptions.filter` |
| `src/common/logger` | 4 | `log-redaction`, `logger`, `security-event`, `security-event-emitters` |
| `src/common/middleware` | 1 | `request-logger.middleware` |
| `src/common/pipes` | 2 | `body-validation-coverage`, `trim-strings.pipe` |
| `src/common/security` | 10 | `api-rate-limit.guard`, `canonical-fingerprint`, `injectable-di-token`, `liff-event-discount-page`, `liff-page-contrast`, `liff-start-handoff`, `redis-rate-limit.service`, `secret-compare`, `trusted-client-ip`, `worker-token` |
| `src/scripts` | 9 | `a5-capacity-mutating.logic`, `a5-capacity-mutating.pg`, `a5-readonly-evidence.logic`, `chart-of-accounts-audit.logic`, `line-identity-inventory.logic`, `production-a5-evidence.logic`, `production-a5-evidence.pg`, `production-a5-reimbursement-compatibility.pg`, `production-a5-reviewed-manifest` |

### ก.3 `apps/web/src` (359 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `common/api` | 7 | `api-error`, `api-error-coverage`, `api-error-message`, `authed-fetch`, `forwarded-client-headers`, `http-client`, `no-raw-api-error-display` |
| `common/auth` | 9 | `auth-cookies.constants`, `change-password-bff.server`, `line-in-app-browser.logic`, `middleware.logic`, `proxy`, `refresh-route`, `server-session`, `session`, `session-gate.logic` |
| `common/client-support` | 1 | `client-support.logic` |
| `common/components/actions` | 2 | `MoreActions`, `action-group.logic` |
| `common/components/app-shell` | 1 | `AppSidebar` |
| `common/components/button` | 2 | `action-loading`, `button-look` |
| `common/components/document-preview` | 1 | `DocumentPreviewModal` |
| `common/components/field` | 6 | `ChoiceRow`, `Field`, `ThemedDate`, `ThemedFile`, `ThemedSelect`, `thai-address.logic` |
| `common/components/mangmee` | 3 | `MangmeePage`, `mangmee-design`, `mangmee-interactive-theme` |
| `common/components/modal` | 2 | `modal-guards`, `use-input-prompt` |
| `common/components/notice` | 1 | `Notice` |
| `common/components/state` | 2 | `BrandedState`, `ForbiddenState` |
| `common/components/steps` | 1 | `ThemedSteps` |
| `common/components/tabs` | 1 | `FilterTabs` |
| `common/components/toast` | 3 | `no-local-toast`, `toast-render`, `toast.logic` |
| `common/components/unsaved-navigation` | 2 | `request-navigation`, `unsaved-navigation.qa` |
| `common/files` | 4 | `document-raster.logic`, `image-pdf.logic`, `upload-consistency`, `upload-file.logic` |
| `common/forms` | 2 | `sanitize`, `trim` |
| `common/functions` | 3 | `deep-link`, `list-query`, `overlay-geometry` |
| `common/hooks` | 1 | `use-dialog-focus` |
| `common/i18n` | 5 | `error-message.logic`, `one-source-words`, `sold-features-wording`, `thai-date`, `workspace-i18n` |
| `common/legal` | 1 | `legal-content` |
| `common/security` | 2 | `csp-dynamic-rendering`, `security-headers.logic` |
| `common/styles` | 3 | `offline-fonts`, `safe-area`, `viewport-units` |
| `common/table` | 1 | `paging.logic` |
| `features/accounting-documents` | 3 | `AccountingPages`, `income-expense-ledger.logic`, `income-record.logic` |
| `features/accounting-tax-setup` | 1 | `accounting-tax-setup.logic` |
| `features/accounts-payable` | 4 | `WhtHandoffDetail.wiring`, `accounts-payable-preview`, `accounts-payable.logic`, `accounts-payable.model` |
| `features/ai-suggestions` | 1 | `ai-suggestions.logic` |
| `features/auth` | 16 | `AccountEmailOtpPanel.qa`, `AccountEmailOtpPanel.state`, `ChangePasswordPage`, `LineQrApprovePage`, `LoginPage`, `account-merge-bff.logic`, `account-merge-ticket-route`, `auth.api`, `auth.logic`, `legal-acceptance.logic`, `line-handoff-route`, `line-login-availability-route`, `line-login-bff.logic`, `line-login-callback-route`, `line-login-start-route`, `login-failure-response.server` |
| `features/banking` | 1 | `banking.logic` |
| `features/billing` | 12 | `BillingAdjustmentsPage.rendered`, `BillingCollectionPanel.rendered`, `BillingEmailRecipientPanel.rendered`, `BillingPage.qa`, `BillingPage.rendered`, `billing-deal`, `billing-display`, `billing-error-text`, `billing-event-discount`, `billing-pending-payment`, `billing-profile-navigation`, `billing-promotion` |
| `features/billing-admin` | 2 | `billing-campaigns.logic`, `billing-refund-promotion` |
| `features/branch-settings` | 4 | `BranchSettingsPage`, `WhtPayerModeSettings`, `branch-form.logic`, `branches.api` |
| `features/company-profile` | 4 | `AccountDisplayName`, `CompanyProfilePage.qa`, `company-profile.logic`, `use-profile-checklist` |
| `features/counterparties` | 4 | `CounterpartiesPage`, `CounterpartyFields`, `counterparties.api`, `counterparties.logic` |
| `features/crm` | 6 | `bookings.model`, `broadcast-prototype.model`, `broadcast.model`, `crm-reports-prototype.model`, `crm.logic`, `customers-prototype.model` |
| `features/crm-inbox` | 2 | `crm-inbox.logic`, `inbox-prototype.model` |
| `features/dashboard-notifications` | 5 | `DashboardPages.rendered`, `NotificationPages`, `dashboard-home.logic`, `dashboard-notifications.api`, `dashboard-notifications.logic` |
| `features/employee-access` | 12 | `DisbursementVoucherAccessHint`, `IndividualPermissionsPrototypePage`, `IndividualPermissionsPrototypePage.rendered`, `RoleBuilder`, `access-overview.model`, `discount-policy.model`, `employee-access.api`, `employee-date.logic`, `employee-email.logic`, `employee-screen-defects`, `po-approval-settings.model`, `role-picker.logic` |
| `features/executive-reports` | 10 | `ExecutiveReportContent`, `ExecutiveReports.wiring`, `executive-browser-review`, `executive-compact-report`, `executive-design-v2`, `executive-export.logic`, `executive-infographic`, `executive-period`, `executive-presentation`, `executive-reports.logic` |
| `features/executive-users` | 2 | `executive-users.logic`, `executive-users.qa` |
| `features/expenses` | 76 | `CategoryManagePanel`, `ClaimPaymentPosting`, `EWhtSettingsPage`, `EvidenceBundleDownload`, `EvidencePanel.qa`, `ExpenseCertificateCard`, `ExpenseCertificateCorrectionNote`, `ExpenseCertificateFile`, `ExpenseCertificateHistory`, `ExpenseCertificateReopen`, `ExpenseCertificateSection`, `ExpenseCertificateVoidDialog`, `ExpenseDisbursementCancellation`, `ExpenseDisbursementReopenNotice`, `ExpenseDisbursementVoucher`, `ExpenseList.rendered`, `ExpensePreviousCertificate`, `ExpenseReviewPage.certificate`, `ExpenseReviewPage.qa`, `ExpenseReviewPage.rendered`, `ExpenseSourceDraftCard`, `ExpensesPages.qa`, `ForeignCurrencyNotice`, `ManualExpenseEntryNotEnabled`, `PaymentDateConfirmation`, `SignaturePanel.load`, `SubstituteReceiptHubPage`, `SubstituteReceiptSettingsPage`, `SubstituteReceiptWizardPage.preview`, `SubstituteReceiptWizardPage.qa`, `WhtCertificatesPage`, `WhtIssueButton`, `WhtPayerIdentityNotice`, `capture-screens-withdrawn`, `evidence-audit.logic`, `expense-address-missing-view.logic`, `expense-buyer-match.logic`, `expense-capture-policy`, `expense-capture-status.logic`, `expense-capture-upload.logic`, `expense-certificate-card.logic`, `expense-certificate-correction.logic`, `expense-confirm-blocker`, `expense-correction`, `expense-focus.logic`, `expense-history.logic`, `expense-input-vat-right`, `expense-list-navigation.logic`, `expense-money-parity`, `expense-notice.logic`, `expense-one-pass-confirm`, `expense-payment-label`, `expense-recording-branch`, `expense-recording-refresh`, `expense-recording-ux`, `expense-review-steps.logic`, `expense-review-validation`, `expense-round-two`, `expense-source-draft.model`, `expense-upload.logic`, `expense-vat-blocked-way-out`, `expense-wht-certificates.logic`, `expense-withholding-ux`, `expenses-audit.logic`, `expenses.api`, `expenses.model`, `manual-expense-entry.logic`, `manual-expense-entry.wiring.qa`, `manual-expense-layout`, `receipt-single-form`, `receipt-upload-flow`, `signature-pad.model`, `substitute-receipt-hub.model`, `substitute-receipt-policy.model`, `substitute-receipt-preview`, `substitute-receipt-wizard.model` |
| `features/expenses/disbursement-vouchers` | 28 | `DisbursementVoucherAccount`, `DisbursementVoucherCommandDialog`, `DisbursementVoucherDocumentFile`, `DisbursementVoucherDocumentPage.qa`, `DisbursementVoucherDocumentPage.rendered`, `DisbursementVoucherDraftPage.qa`, `DisbursementVoucherDraftPage.rendered`, `DisbursementVoucherListPage.qa`, `DisbursementVoucherListPage.rendered`, `DisbursementVoucherMoneyConfirmation`, `DisbursementVoucherPayCard.qa`, `DisbursementVoucherPayeePicker.rendered`, `DisbursementVoucherReissue`, `DisbursementVoucherSlip`, `DisbursementVoucherSupportingFiles`, `DisbursementVoucherWithholding`, `disbursement-voucher-account.logic`, `disbursement-voucher-document.logic`, `disbursement-voucher-expense.logic`, `disbursement-voucher-form.logic`, `disbursement-voucher-journey.logic`, `disbursement-voucher-payment.logic`, `disbursement-voucher-reissue.logic`, `disbursement-voucher-screen-fixes`, `disbursement-voucher-slip.api`, `disbursement-vouchers.api`, `disbursement-vouchers.logic`, `use-disbursement-voucher-refresh` |
| `features/external-signup` | 10 | `ClaimAccountPage.qa`, `SignupPage.qa`, `SignupStatusPage.qa`, `external-signup.api`, `signup-claim-bff.forwarded-ip`, `signup-copy.qa`, `signup-mobile.qa`, `signup-pages.qa`, `signup.logic`, `welcome-handoff.logic` |
| `features/inventory` | 2 | `InventoryPages`, `inventory.logic` |
| `features/ledger` | 2 | `chart-master.logic`, `ledger.logic` |
| `features/plan-term` | 2 | `plan-term.api`, `plan-term.logic` |
| `features/procurement` | 1 | `procurement.logic` |
| `features/public-home` | 16 | `HalloweenGhostGame.lifecycle`, `HomeHalloweenActivities.lifecycle`, `PublicHome.rendered`, `home-events`, `home-halloween-candy`, `home-halloween-cards`, `home-halloween-countdown`, `home-halloween-draw`, `home-halloween-draw.server`, `home-halloween-escape`, `home-halloween-provenance`, `home-halloween-reveal-audio`, `home-halloween-share`, `home-help-v6`, `home-routes`, `home-theme.server` |
| `features/reimbursements` | 18 | `ReimbursementCertificateCancelDialog`, `ReimbursementCreatePage.qa`, `ReimbursementDetailSections.rendered`, `ReimbursementDraftActionPage.qa`, `ReimbursementPages.plain-thai.qa`, `ReimbursementPayStep.qa`, `ReimbursementPaymentForm.qa`, `ReimbursementPayout.qa`, `ReimbursementsPages.rendered`, `reimbursement-payout-correction.qa`, `reimbursement-saved-payout`, `reimbursement-screen-defects`, `reimbursement-stranded-claims.qa`, `reimbursements-preview`, `reimbursements.api`, `reimbursements.logic`, `reimbursements.model`, `reimbursements.payment-slip` |
| `features/reports` | 1 | `reports-ui.logic` |
| `features/sales-console` | 7 | `SalesDealFormPage.rendered`, `SalesDemoLinkDialog`, `sales-console.logic`, `sales-console.qa`, `sales-event-report.logic`, `sales-events.logic`, `sales-waiting-shops.qa` |
| `features/sales-demo` | 4 | `DemoFlexMessage`, `DemoLineChat`, `demo-line-chat.logic`, `demo-open-route` |
| `features/system-data-rights` | 2 | `data-rights.api`, `data-rights.logic` |
| `features/system-onboarding` | 1 | `SystemOnboardingNewPage.qa` |
| `features/system-partners` | 7 | `PartnerSupportTools.qa`, `ai-budget.logic`, `company-team-note`, `manual-web-entry-switch.qa`, `plan-term.logic`, `report-labels.logic`, `system-partners.logic` |
| `features/system-signup-requests` | 3 | `SignupQueuePage.qa`, `SignupRowActions`, `signup-queue.logic` |
| `features/system-support-requests` | 3 | `SupportRequestsPage.qa`, `SupportRowActions`, `support-requests.logic` |
| `features/system-wht-income-categories` | 1 | `wht-income-categories` |
| `features/tax` | 7 | `TaxSignatureSettingsPage`, `WithholdingPage`, `tax.logic`, `trade-tax-evidence-preview`, `transaction-tax-suggestion`, `transaction-tax.api`, `transaction-tax.model` |
| `features/user-guide` | 3 | `disbursement-voucher-guide.content`, `expenses-guide-manual-entry`, `user-guide.content` |
| `features/web-core-workspace` | 9 | `branch-scope-label.logic`, `menu-filter`, `permission-page-visibility`, `settings-menu.logic`, `sold-features-regressions`, `transaction-create-branch`, `web-core-workspace`, `workspace-layout.qa`, `workspace-scope.api` |
| `features/workflow` | 1 | `workflow.logic` |

### ก.4 `apps/ai-gateway/src` (73 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 1 | `app.boot` |
| `agentcore` | 2 | `runtime`, `runtime-minimal-env` |
| `auth` | 1 | `ai-auth` |
| `common/ai` | 2 | `extract-json`, `tool-policy-enforcer` |
| `common/http` | 1 | `production-maintenance.middleware` |
| `common/logger` | 2 | `log-redaction`, `logger` |
| `common/security` | 1 | `internal-secret` |
| `common/usage` | 2 | `ai-usage.interceptor`, `usage-context` |
| `modules/ai-draft` | 1 | `generate-draft.use-case` |
| `modules/crm-customer-ai` | 2 | `crm-customer-ai-internal.controller`, `crm-customer-ai.separation` |
| `modules/crm-customer-ai/agents` | 8 | `crm-booking-extract.agent`, `crm-broadcast.agent`, `crm-conversation-summary.agent`, `crm-customer-intake.agent`, `crm-customer-profile-extract.agent`, `crm-customer-reply.agent`, `crm-insights.agent`, `crm-trust-score.agent` |
| `modules/line-ai/agents` | 31 | `agent-tools.parity`, `agent-tools.registry`, `approved-knowledge`, `business-read-result-semantics`, `coverage-critic.agent`, `draft-update-formatter`, `expense-explain-record`, `intent-router.agent`, `line-ai-business-query-regression`, `line-ai-feature-coverage`, `line-intake-compact-decision`, `line-intake-reply`, `line-intake-router.agent`, `mangmee-persona`, `orchestrator-model-loop.agent`, `orchestrator-native-loop.agent`, `orchestrator.agent`, `prepared-simple-read-formatter`, `prepared-simple-read-security`, `read-tool-input`, `response-composer.agent`, `semantic-retained-source`, `semantic-turn-v2-approval-backlog`, `semantic-turn-v2-compose-skip`, `semantic-turn-v2-grounding`, `semantic-turn-v2-memory-filter-grounding`, `semantic-turn-v2-pending-work`, `semantic-turn-v2-persona-sanitize`, `semantic-turn-v2-read-filter-binding`, `semantic-turn-v2-terminal-outcomes`, `tool-availability` |
| `modules/line-ai/application` | 1 | `document-qa.integration` |
| `modules/line-ai/application/use-cases` | 3 | `line-ai-turn-v2.integration`, `line-ai-turn.fixed-read`, `line-ai-turn.use-case` |
| `modules/line-ai/domain/logic` | 6 | `business-document-classification.logic`, `business-read-result-semantics`, `line-ai-scope-policy.logic`, `line-ai-turn`, `prepared-simple-read.logic`, `session-affinity.logic` |
| `modules/line-ai/infrastructure` | 1 | `erp-tool.client` |
| `modules/line-ai/infrastructure/provider` | 4 | `bedrock.provider`, `disabled.provider`, `openai.provider`, `public-lookup` |
| `modules/line-ai/infrastructure/runtime` | 1 | `agentcore-runtime.client` |
| `modules/line-ai/presentation/http` | 3 | `expense-capture-routes`, `line-ai-internal.controller`, `line-reliability-capabilities.controller` |

### ก.5 `apps/workers/src` (12 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 1 | `main` |
| `common` | 4 | `internal-api`, `log`, `queue`, `retry-schedule` |
| `modules/expense-auto-post` | 1 | `expense-auto-post-worker` |
| `modules/notifications` | 2 | `notification-delivery-demo`, `notification-jobs` |
| `modules/object-version-cleanup` | 1 | `object-version-cleanup-worker` |
| `modules/outbox` | 1 | `outbox-smoke` |
| `modules/plan-term-sweep` | 1 | `plan-term-sweep-worker` |
| `modules/signup-claim-email` | 1 | `signup-claim-email-worker` |

### ก.6 `packages` (30 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `config/src` | 2 | `deployment-identity-manifest.test.ts`, `index.test.ts` |
| `contracts/src` | 28 | `ai-budget-bounds-v2`, `billing-addon`, `billing-company-profile`, `business-policy`, `buyer-snapshot-v1`, `civil-date`, `company-business-type`, `company-tax-identity`, `data-rights`, `employee-access`, `expense-evidence`, `expenses-wording`, `feature-entitlements`, `legal-acceptance`, `line-ai-advisor-answer`, `line-ai-input-evidence`, `line-ai-prepared-plan`, `line-ai-public-lookup`, `line-ai-record-text`, `line-ai-value-candidates-v2`, `line-ai-value-normalizer`, `line-document-qa`, `line-external-browser`, `line-reimbursement-draft`, `plan-term`, `prisma-enum-parity`, `reimbursements`, `tax` |

### ก.7 `e2e` (90 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 70 | `_reference`, `_roles-reference`, `account-email-otp-ux`, `accounting`, `accounts-payable`, `ai-suggestions`, `autonomy-toggle`, `banking`, `billing-admin-directory`, `billing-admin-document-tools`, `billing-admin-menu-ux`, `billing-advance-deal`, `billing-no-setup`, `billing-preview`, `billing-promotion`, `bookings`, `branch-scope`, `business-smoke`, `client-support`, `counterparties`, `crm`, `crm-reports`, `cross-cutting`, `customer-billing-ux`, `daily-brief`, `dashboard`, `employee-job-title`, `evidence`, `executive-report`, `expense-capture-intake`, `expense-capture-intake.evidence`, `expense-number-save`, `expense-running-number`, `expenses`, `feature-entitlement-accessibility`, `income-expense-ledger`, `inventory`, `journal`, `legal-acceptance`, `liff-xss`, `line-recovery`, `line-signup-contact-email`, `local-active-feature-regression`, `login`, `manual-expense-web-entry`, `notifications`, `plan-term-billing-readiness`, `procurement`, `profile-completeness-card`, `receipt-draft-continuity`, `reimbursement-receipt`, `reimbursements`, `reports`, `reports-bi-smoke`, `responsive`, `responsive-baseline`, `sales-console`, `settings`, `sidebar-nav`, `substitute-cancelled-view-only`, `substitute-editable-navigation`, `system-admin`, `system-settings-ux`, `system-support-resolution`, `toast-feedback`, `transaction-branch`, `transaction-tax`, `wht-settlement`, `withholding-page`, `workflow` |
| `journeys` | 20 | `billing-first-card-renewal.journey`, `billing-first-promptpay.journey`, `billing-renew-or-top-up.journey`, `billing-stop-auto-renewal.journey`, `billing-unfinished-payment.journey`, `claim-declined-then-paid.journey`, `e-wht-payment.journey`, `evidence-and-settings.journey`, `expense-input-vat-right.journey`, `no-receipt-certificate.journey`, `package-upgrade-unlocks-50-tawi.journey`, `paid-expense-reopened.journey`, `payment-document-two-people.journey`, `plain-shop-records-everything.journey`, `public-home.journey`, `shop-menus-everyday.journey`, `staff-receipt-from-phone.journey`, `team-and-roles.journey`, `voucher-supporting-files.journey`, `withholding-forms.journey` |

### ก.8 `scripts` (29 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `.` | 19 | `brain-family-questions.golden`, `expense-capture-read.fixtures`, `expense-category.golden`, `line-ai-intake-cost.corpus`, `line-ai-latency-autonomy.corpus`, `line-ai-natural-conversation-corpus`, `line-ai-natural-wire-report`, `line-ai-operator-language.corpus`, `line-ai-reliability-blind-comparison`, `line-ai-reliability-corpus`, `line-ai-reliability-evaluation`, `line-ai-reliability-fixtures`, `line-ai-reliability-runtime`, `line-ai-reliability-runtime-reset.pg`, `line-ai-substitute-routing.corpus`, `line-ai-whole-chain-acceptance-catalog.spec.mjs`, `run-line-ai-controlled-image-replay.spec.mjs`, `run-line-ai-operator-language-eval`, `run-line-ai-operator-language-replay` |
| `line-ai-expense-advisor` | 6 | `oracle`, `report`, `run-rescore`, `scorer`, `template`, `types` |
| `line-oa` | 3 | `rich-menu-v2-ver1.manifest.spec.mjs`, `rich-menu-v2-ver2.manifest.spec.mjs`, `rich-menu-v2-ver3.manifest.spec.mjs` |
| `qa` | 1 | `journey-mobile` |

### ก.9 `infra` (JavaScript) (3 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `api-web` | 1 | `web-api-proxy.spec.mjs` |
| `cloudflare` | 1 | `mangmee-host-proxy.worker.spec.mjs` |
| `line-official` | 1 | `handler.spec.cjs` |

### ก.10 `docs` (สำเนาหลักฐาน ไม่อยู่ใน suite) (7 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `deliverables/iso29110-2026-09-06/evidence` | 2 | `E13-expense-review-validation`, `E14-expense-draft-vat-decouple.use-case` |
| `evidence/manual-expense-web-entry-flag-2026-10-01/harness` | 2 | `manual-flag-extended`, `manual-flag-simulation` |
| `evidence/package-entitlements-2026-09-11` | 1 | `source-contract` |
| `evidence/stripe-readiness-2026-09-11` | 1 | `recovery.pg` |
| `evidence/stripe-repair-2026-09-11` | 1 | `recovery.pg` |

### ก.11 `infra` (shell spec และ Python unittest) (81 ไฟล์)

| โฟลเดอร์ | ไฟล์ | รายชื่อ |
|---|---:|---|
| `ai-gateway` | 4 | `agentcore-candidate-binding.spec.sh`, `h15-trust-boundary.spec.sh`, `line-ai-release-manifest.spec.sh`, `m01-actor-delegation.spec.sh` |
| `dev-kamal` | 1 | `release_inventory_test.py` |
| `docker` | 8 | `ecr-scan-blocking-findings.spec.sh`, `generate-image-sbom.spec.sh`, `production-fast-promotion.spec.sh`, `production-image-security.spec.sh`, `production-maintenance-workflow.spec.sh`, `production-release-intent.spec.sh`, `resolve-production-fast-mode.spec.sh`, `uat-deployment-acceptance.spec.sh` |
| `kamal` | 8 | `first_migration_rehearsal_test.py`, `first_migration_test.py`, `production_stack_test.py`, `release_paths_test.py`, `release_source_test.py`, `release_test.py`, `shutdown_test.py`, `stability_test.py` |
| `monitoring` | 1 | `runtime-alarms.spec.sh` |
| `postmark` | 1 | `config_test.py` |
| `prod-ecs-express` | 19 | `bounded-http-retry.spec.sh`, `cleanup-one-shot-task.spec.sh`, `express-capacity.spec.sh`, `list-service-deployments-all.spec.sh`, `maintenance-preflight.spec.sh`, `prod-rollout-config.spec.sh`, `production-ready-release-task.spec.sh`, `production-serving-mode.spec.sh`, `recover-production-minimum-capacity.spec.sh`, `register-task-definition-with-retry.spec.sh`, `reimbursement-write-quiesce.spec.sh`, `release-safety.spec.sh`, `release-task-network-failover.spec.sh`, `rollout-waves.spec.sh`, `run-task-idempotently.spec.sh`, `system-admin-cutover.spec.sh`, `uat-fast-rollout.spec.sh`, `verify-production-maintenance.spec.sh`, `wait-production-maintenance-ingress-drain.spec.sh` |
| `security` | 31 | `object-version-cleanup-iam.spec.sh`, `production-a5-apply-runner.spec.sh`, `production-a5-clone-bootstrap.spec.sh`, `production-a5-clone-runner.spec.sh`, `production-a5-clone-workflow.spec.sh`, `production-a5-current-health.spec.sh`, `production-a5-migration-tool-registry-evidence.spec.sh`, `production-a5-private-network.spec.sh`, `production-a5-readonly-bootstrap.spec.sh`, `production-a5-readonly-runner.spec.sh`, `production-a5-result.spec.sh`, `production-a5-stage-context-producer.spec.sh`, `production-a5-workflow.spec.sh`, `production-deploy-workflow-v2.spec.sh`, `production-migration-catalog-readiness.spec.sh`, `production-promotion-bootstrap.spec.sh`, `production-promotion-resources.spec.sh`, `production-readiness-workflow-v2.spec.sh`, `production-ready-baseline-v2.spec.sh`, `production-release-prepare-wait.spec.sh`, `production-release-ready-v2.spec.sh`, `production-release-result-v2.spec.sh`, `production-runtime-readiness-v2.spec.sh`, `production-security-preflight.spec.sh`, `provision-legal-release-evidence.spec.sh`, `signed-evidence.spec.sh`, `sync-production-maintenance-release-pins.spec.sh`, `u5-production-chain.spec.sh`, `uat-release-passport-v2.spec.sh`, `validate-legal-release-readiness.spec.sh`, `validate-production-maintenance-release.spec.sh` |
| `uat` | 8 | `a5-capacity-controller.spec.sh`, `agentcore-candidate-policy.spec.sh`, `bootstrap-a5-readonly.spec.sh`, `fast-selective-workflow.spec.sh`, `redis-blue-green.spec.sh`, `redis-encryption.spec.sh`, `select-deploy-target.spec.sh`, `verify-deploy-readiness.spec.sh` |

