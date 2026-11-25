# 08 — การ Deploy, การปฏิบัติการ และการบำรุงรักษา (Deployment, Operations & Maintenance)

**วัตถุประสงค์:** เอกสารนี้บันทึกว่าระบบ MangmeePlus / WatchDog-BMS ถูกวางบนโครงสร้างพื้นฐานอย่างไร, build และปล่อยขึ้น UAT/Production อย่างไร, ต้องตั้งค่าอะไรบ้าง (ชื่อ environment variable และ secret ทุกตัว — ไม่มีค่า), ดูแลฐานข้อมูล/การเฝ้าระวัง/ค่าใช้จ่าย/ความปลอดภัยอย่างไร, runbook ทั้งหมดอยู่ที่ไหน, ทีมใหม่ต้องตั้งเครื่องและขยายระบบอย่างไร, อะไรถูกปิดและสำรองไว้ตอนปิดโครงการ และขั้นตอนเรียงลำดับเพื่อกู้ระบบกลับขึ้นมาจาก archive

**ที่มา:** checkout `closeout-docs-main` = `origin/main` commit `08850deaf` (2026-11-10) โค้ดคือความจริง; `docs/` ใช้ประกอบเจตนาและประวัติ มีข้อยกเว้นสองจุดที่ **ไม่อยู่ใน commit นี้** และอ่านจาก working tree ของเจ้าของตามคำสั่งงาน: `docs/agent-memory/prod-uat-power-down-2026-11-15.md` และส่วนบนสุดของ `docs/runbooks/cloud-environment-operations.md` ฉบับ 2026-11-16 (หัวข้อ 9) ส่วนภาคผนวกการปิด 2026-11-16 ในหัวข้อ 9.4 เป็นข้อเท็จจริงที่เจ้าของให้มา ไม่ได้ตรวจกับระบบ

**ข้อจำกัด:** ไม่ได้เรียก AWS, Cloudflare, Stripe, LINE หรือ Postmark ระหว่างเขียน ทุกสถานะ cloud มาจากบันทึกใน repo เอกสารนี้ไม่พิมพ์ค่า secret, token, รหัสผ่าน หรือเลขบัญชีผู้ให้บริการภายนอก

## สารบัญ

1. [สภาพแวดล้อมและ topology](#1-สภาพแวดล้อมและ-topology)
2. [สาย build และ release ตั้งแต่ต้นจนจบ](#2-สาย-build-และ-release-ตั้งแต่ต้นจนจบ)
3. [Configuration reference — environment variable และ secret ทุกตัว](#3-configuration-reference--environment-variable-และ-secret-ทุกตัว)
4. [การปฏิบัติการฐานข้อมูล](#4-การปฏิบัติการฐานข้อมูล)
5. [Monitoring, log, alarm, การคุมค่าใช้จ่าย และงบ AI](#5-monitoring-log-alarm-การคุมค่าใช้จ่าย-และงบ-ai)
6. [การปฏิบัติการด้านความปลอดภัย](#6-การปฏิบัติการด้านความปลอดภัย)
7. [ดัชนี runbook](#7-ดัชนี-runbook)
8. [คู่มือบำรุงรักษา](#8-คู่มือบำรุงรักษา)
9. [บันทึกการปลดระวาง (decommission)](#9-บันทึกการปลดระวาง-decommission)
10. [Checklist การสร้างระบบขึ้นใหม่](#10-checklist-การสร้างระบบขึ้นใหม่)
11. [ข้อกำหนดเชิงปฏิบัติการ (NFR) ที่เอกสารนี้นิยาม](#11-ข้อกำหนดเชิงปฏิบัติการ-nfr-ที่เอกสารนี้นิยาม)
12. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#12-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)

---

## 1. สภาพแวดล้อมและ topology

### 1.1 ภาพรวมสี่สภาพแวดล้อม

| สภาพแวดล้อม | `APP_ENV` / `DEPLOY_ENVIRONMENT` | ที่รัน | สถานะตอนปิด |
|---|---|---|---|
| Local | `local` / `local` | Docker Compose (`infra/docker/compose.local.yml`) หรือ process ตรงจาก source (Playwright, proof stack) | ใช้ได้จาก archive |
| Dev (isolated rehearsal) | `production` / kind `dev` | EC2 เดี่ยวใช้ซ้อมตัวควบคุม Kamal กับ PostgreSQL/Redis สังเคราะห์ (`rehearse-cloud.py`) | ปลดระวาง 2026-10-07 ไม่ได้กู้กลับ |
| UAT | `production` / `uat` | Kamal บน EC2 2 เครื่อง + RDS + ElastiCache + ALB + AgentCore | ลบ 2026-11-15/16 |
| Production | `production` / `production` | Kamal บน EC2 4 เครื่อง + RDS Multi-AZ + ElastiCache 2 node + ALB + AgentCore | ลบ 2026-11-15/16 |

`APP_ENV` ตัดสินโหมดความปลอดภัย (มีแค่ `local`/`production`); `DEPLOY_ENVIRONMENT` บอกว่า deployment นี้คืออะไร และ process ที่ `APP_ENV=production` จะไม่ boot ถ้าไม่มี `DEPLOY_ENVIRONMENT` เป็น `uat`/`production` และ `GIT_SHA` 40 ตัวอักษรหรือ `IMAGE_DIGEST` (`packages/config/src/index.ts` `resolveDeploymentIdentity`)

บัญชีและภูมิภาค: AWS account `311414082667`, `ap-southeast-1` ทั้งหมด (`infra/kamal/release_source.py`)

### 1.2 บริการที่ deploy ได้และ image

| บริการ Kamal | ประกอบด้วย | Dockerfile | Port ภายใน |
|---|---|---|---|
| `api-web` | ERP API (NestJS) + web (Next.js standalone) + proxy หน้าเดียว + ClamAV (`clamd` ที่ `127.0.0.1:3310`, `freshclam`) | `infra/api-web/Dockerfile.api-web`, เริ่มด้วย `infra/api-web/start-api-web-runtime.sh`, proxy `infra/api-web/web-api-proxy.mjs` | `PORT=3000` (proxy), `API_PORT=3001`, `WEB_PORT=3002` |
| `ai-gateway` | AI Gateway (NestJS) | `apps/ai-gateway/Dockerfile` | 3002 ใน local |
| `workers` | BullMQ workers | `apps/workers/Dockerfile` | — |
| `tools` | image ที่มี Prisma/tsx สำหรับ migration, sync และ retire build | stage `migration-tool`/`release-task` ใน `apps/api/Dockerfile`, `infra/dev-kamal/Dockerfile.tools` | — |
| AgentCore runtime | โค้ด agent ของ LINE AI ที่รันบน Amazon Bedrock AgentCore | `infra/ai-gateway/build-agentcore-artifact.sh` (archive ไม่ใช่ container) | — |

Dockerfile ทั้งหก (`apps/web/Dockerfile`, `apps/web/Dockerfile.lambda`, `apps/api/Dockerfile`, `apps/ai-gateway/Dockerfile`, `apps/workers/Dockerfile`, `infra/api-web/Dockerfile.api-web`) ใช้ base เดียวกันที่ pin ด้วย digest: `node:22.23.4-trixie-slim` (Debian 13) ย้ายจาก `node:22-bookworm-slim` เมื่อ 2026-09-19 เพราะ Debian 12 หมด regular security support; image `api-web` ติดตั้ง ClamAV 1.5.4 จาก release ของ Cisco Talos และ font `fonts-noto-core` สำหรับ PDF ภาษาไทย

### 1.3 Topology ของ UAT และ Production (ยุค Kamal, ตั้งแต่ 2026-09)

| ชิ้นส่วน | UAT | Production |
|---|---|---|
| CloudFormation stack | `mangmee-kamal-uat` (+ `mangmee-uat-power` สำหรับ Plan A) | `mangmee-kamal-production` |
| EC2 | 2 เครื่อง: API (`t3.large`, AZ 1a) และ AI+workers (`t3.medium`, AZ 1c), gp3 40 GiB | 4 เครื่อง: API 2 เครื่องคนละ AZ, AI 1, workers 1 |
| กฎการแยก host | API host ต้องแยกจาก AI/worker host เพื่อรักษาขอบเขต IAM ของ runtime; AI กับ workers ใช้ host ร่วมได้ | เหมือนกัน + API อย่างน้อย 2 host ใน 2 AZ |
| การเข้าถึง host | SSH ผ่าน tunnel ของ SSM Session Manager เท่านั้น (`sshTransport: ssm`); ไม่เปิด TCP/22 สาธารณะ; IMDSv2 hop limit 2 | เหมือนกัน |
| Load balancer | ALB `mangmee-uat-gateway` | ALB `mangmee-production-gateway` |
| Origin (DNS-only) | `uat-origin.mangmeeplus.com`, `uat-ai-origin.mangmeeplus.com` | `origin.mangmeeplus.com`, `ai-origin.mangmeeplus.com` |
| TLS | ACM certificate บน ALB; Cloudflare หน้า edge | เหมือนกัน |
| ฐานข้อมูล | RDS `watchdog-bms-uat-db`, PostgreSQL 18.3, `db.t4g.micro`, Single-AZ, 20 GiB, backup 1 วัน, private | RDS `watchdog-bms-prod-db`, PostgreSQL 18.3, `db.t4g.small`, Multi-AZ, เข้ารหัส, deletion protection, backup 35 วัน, client `verify-full` |
| Redis | ElastiCache `watchdog-bms-uat-redis`, `cache.t4g.micro` 1 node | replication group `watchdog-bms-prod-redis`, 2× `cache.t4g.micro`, Multi-AZ, TLS + auth + เข้ารหัส at rest, snapshot 35 วัน |
| Object storage | S3 bucket ของแอป (versioning, lifecycle จาก `infra/object-storage-lifecycle.json`, บล็อก public ครบ, SSE-S3, CORS ของเบราว์เซอร์, บล็อก SSE-C) | เหมือนกัน |
| Registry | ECR repository ของ environment (tag ไม่เปลี่ยนรูป, ไม่มี lifecycle rule) | แยกของตัวเอง |
| Signing | KMS asymmetric key ของ UAT | KMS asymmetric key ของ Production (ECDSA_SHA_256) |
| AgentCore | runtime `watchdog_orchestrator_uat_kamal-…`, endpoint `kamal_uat_a`/`kamal_uat_b` (หนึ่งตัวใช้งาน หนึ่งตัวสำรอง) | runtime `watchdog_orchestrator_production_kamal-…`, endpoint `kamal_production_a`/`kamal_production_b` |
| Proxy บน host | Kamal proxy v0.9.2 (pin digest), Docker network `kamal` (`infra/kamal/bootstrap-host.sh`) | เหมือนกัน |
| Log | CloudWatch log group 3 กลุ่มของ Kamal, เก็บ 3 วัน | เก็บ 14 วัน |
| Secret | AWS Secrets Manager ใต้ `watchdog-bms/uat/…` + SSM Parameter Store | ใต้ `watchdog-bms/production/…` |

### 1.4 Edge, DNS และโดเมน

| รายการ | ค่า | แหล่ง |
|---|---|---|
| ผู้ให้บริการ DNS | Cloudflare (nameserver `cory`/`dayana.ns.cloudflare.com`); ไม่มี Route 53 zone | `docs/runbooks/ses-email-setup.md`, บันทึกปลดระวาง |
| โดเมน | `mangmeeplus.com` (หมดอายุ 2027-07-05 ตามภาคผนวกการปิด) | หัวข้อ 9.4 |
| Production public | `https://mangmeeplus.com/` — หน้าแรกสาธารณะที่ `/`, ล็อกอินที่ `/login`; Proxied ผ่าน Cloudflare Worker | cloud runbook 2026-10-21 |
| `www.mangmeeplus.com` | CNAME → apex, Single Redirect 301 ไป apex | เหมือนกัน |
| `official.mangmeeplus.com` | Single Redirect 301 ไป `https://mangmeeplus.com/` (เดิมเป็น Cloudflare Pages `mangmeeplus-web.pages.dev`) | เหมือนกัน |
| UAT public | `https://uat.mangmeeplus.com/` ผ่าน Worker; ส่ง `X-Robots-Tag: noindex, nofollow` | เหมือนกัน |
| `app.mangmeeplus.com` | ปรากฏเฉพาะใน spec/ตัวอย่าง URL ของอีเมล — **ไม่พบเป็น host ที่ deploy** | `git grep` |
| Worker | `infra/cloudflare/mangmee-host-proxy.worker.js` (production) และ `mangmee-uat-host-proxy.worker.js` (UAT): เขียน Host header ใหม่ไปยัง origin, ส่ง `X-Forwarded-Host`/`X-Forwarded-Proto`, แก้ redirect ที่รั่วชื่อ origin; เดิมจำเป็นเพราะ gateway ของ ECS Express route ตาม Host และ Origin Rules เป็นฟีเจอร์ Enterprise | โค้ด |
| กฎ redirect | HTTP → HTTPS ของ apex (308), official `/sitemap.xml` และ `/robots.txt` → apex, Bulk Redirect ของ `*.pages.dev` | cloud runbook 2026-10-21 |
| อีเมล | Postmark (DKIM/Return-Path ใน DNS); กล่องรับ `contact@mangmeeplus.com` อยู่บน Google Workspace; SPF รวม Google | `infra/postmark/config.json`, `docs/runbooks/ses-email-setup.md` |
| Webhook ขาเข้า | LINE: `https://origin.mangmeeplus.com/v1/line/webhook` (production), `https://uat-origin.mangmeeplus.com/v1/line/webhook` (UAT); Postmark: `/v1/public/postmark-events`; Stripe: endpoint สาธารณะของ API | cloud runbook 2026-10-09 |

หมายเหตุ: ไฟล์ Worker ใน repo ยังมีค่า `ORIGIN` เป็น hostname ของ ECS Express รุ่นเก่า ขณะที่ runbook บันทึกว่า Worker ที่ใช้งานจริงชี้ `origin.mangmeeplus.com` ตั้งแต่ 2026-10-09 — **โค้ดใน repo ไม่ตรงกับ Worker ที่ deploy** ทีมใหม่ต้องแก้ค่า origin ก่อน publish

### 1.5 LINE Official Account

| OA | บทบาท | ที่รัน |
|---|---|---|
| OA ของระบบ/ร้าน (ERP route) `@458wpnio` | LINE AI "น้องมั่งมี", สมัครร้าน, การ์ดงาน | webhook ของ API production |
| OA ทางการ `@695ultfm` (เดิม `@107ewccg` รันแยกบน Lambda) | การ์ดติดต่อ/โซเชียล ตั้งแต่ 2026-10-12 ย้ายมาตอบผ่าน ERP route (`LINE_OFFICIAL_REPLY_ENABLED`) | เดิม `infra/line-official/` (CloudFormation stack `watchdog-bms-line-official-oa-prod`, Lambda Node.js 24/arm64) — ปลดระวาง 2026-10-07 |
| OA ของ UAT `@234jrspv` | ทดสอบ | webhook ของ API UAT |
| LINE OA ของร้านคู่ค้า (CRM) | แต่ละร้านเชื่อม OA ของตัวเองผ่านหน้า "ตั้งค่า LINE OA"; credential เข้ารหัสด้วย `CREDENTIAL_ENCRYPTION_KEY` | `docs/runbooks/partner-onboarding-e2e.md`, `b1-b2-line-external-setup.md` |

### 1.6 ประวัติโครงสร้างพื้นฐาน

| ช่วง | สิ่งที่ใช้ | บันทึก |
|---|---|---|
| ก.ค. 2026 | App Runner (รุ่นแรก) → ECS Express Mode สำหรับ `api-web`, `ai-gateway`, `workers`; Cloudflare Worker เขียน Host | `infra/prod-ecs-express/`, `docs/adr/0005-aws-first-hosting-and-deployment-strategy.md`; App Runner เหลือเป็น "legacy rollback only" ใน `infra/docker/README.md` |
| ส.ค. 2026 | ค่าใช้จ่ายพุ่งจาก workers ของ UAT crash-loop (log ingest ~152 GB); ลบ NAT gateway ที่ไม่มี traffic; สร้าง Redis production ใหม่แบบเข้ารหัส; go-live production ด้วย ceremony A5/U5 และ V2 (Passport/READY ผ่าน GitHub Actions) | `docs/agent-memory/aws-cost-spike-2026-08.md`, `docs/runbooks/production-golive-aws-commands.md`, `production-a5-u5-promotion-ceremony.md` |
| 2026-09-11 | UAT ย้ายเป็น Kamal บน EC2; พิสูจน์ deploy ซ้ำสองครั้ง ~4 นาที (cache อุ่น), 11 นาที 15 วินาที (cache เย็น) | `infra/kamal/README.md`, `docs/research/kamal-uat-*-proof-*.md` |
| 2026-09-18 | Production ย้าย ECS → Kamal ผ่านโหมด `--first-migration`; ECS ถูกจอดที่ 0/0 แล้วปิดหน้าต่าง rollback | cloud runbook "Current Production Kamal — 2026-09-18" |
| 2026-09-19 | base image เป็น Debian 13 (trixie), เพิ่ม ClamAV | `docs/qa/evidence/base-image-trixie-ab-*.md` |
| 2026-09-23 | production เปิดขายจริง: ซื้อและคืนเงินจริงผ่าน Stripe live (249 บาท คืนเต็ม) | cloud runbook "September cost readback" |
| 2026-10-07 | ปลดระวาง AWS ทั้งหมดครั้งแรก (รวม Dev และ Official OA) หลังสำรอง offline | cloud runbook "AWS runtime and storage retired" |
| 2026-10-09 | กู้ Production และ UAT กลับจาก backup offline (PostgreSQL, Redis, S3 version, secret, KMS key เดิม) | cloud runbook "disaster restoration completed" |
| 2026-10-10 → 10-29 | UAT ใช้แบบเปิด-ปิดตามต้องการ (Plan A: หยุด EC2 + RDS เมื่อไม่ใช้) | `docs/agent-memory/uat-power-*.md` |
| 2026-10-20 | ปิด GitHub Actions; release ทั้งหมดใช้ Kamal จากเครื่อง | `docs/plans/ops-followups-2026-10-23-plan.md` |
| 2026-11-10 | release production ครั้งสุดท้าย (main `531619870`) | cloud runbook ส่วนบน |
| 2026-11-15/16 | ปลดระวางถาวร (หัวข้อ 9) | — |

---

## 2. สาย build และ release ตั้งแต่ต้นจนจบ

มีสองสาย: **สาย Kamal จากเครื่องผู้ปฏิบัติงาน** (ใช้จริงตั้งแต่ 2026-09 และเป็นสายเดียวหลัง 2026-10-20) และ **สาย V2 ผ่าน GitHub Actions** (UAT → READY → Production; เป็น protocol ที่ `AGENTS.md` บังคับให้อ่านก่อนทุก release แต่ไม่ถูก dispatch แล้ว) หลักการร่วมที่ทั้งสองสายบังคับ: production ใช้ image digest ชุดเดียวกับที่ UAT build/test/เซ็นแล้วโดยไม่ rebuild; ไม่ dispatch ซ้ำเพื่อหา error; ล้มที่ไหนหยุดที่นั่นและ reconcile ก่อน retry; การเปิดให้ลูกค้าใช้เป็นขั้นแยกจากการ deploy (PlatformAccess `OPEN`)

### 2.1 สาย Kamal (ใช้จริง)

```
origin/main (pin SHA)
  └─ prepare: clean checkout → TypeScript → image 4 ตัว (api-web, ai-gateway, workers, tools) + AgentCore archive
       → ตรวจ config ครบกับ image ที่ build → render Kamal config 3 ตัว → (ถ้า --publish-images) push tag prepared-*
       → result: PREPARED_NO_DEPLOYMENT
  └─ apply (UAT): lock ระยะไกล → push/pull → เตรียม AgentCore endpoint สำรอง → migration + catalog + sync
       → rollout api-web, ai-gateway, workers → readback image/env → health ลึก → customer OPEN
       → retire build เก่า → เซ็น accepted.json ด้วย KMS → ปิด SSM session
       → result: ACCEPTED_LINE_DEFERRED (12 phase)
  └─ promote (Production): ตรวจลายเซ็น UAT (อายุ ≤ 24 ชม.) → คัดลอก digest เดิม ไม่ rebuild → ขั้นเดียวกับ apply
       → browser acceptance โดยเจ้าของ → เซ็น
```

| คำสั่ง | หน้าที่ |
|---|---|
| `infra/kamal/deploy-uat --profile <p>` | preflight อ่านอย่างเดียว (ค่าเริ่มต้นเมื่อไม่มี `--prepare`/`--apply`) |
| `infra/kamal/deploy-uat --profile <p> --prepare --publish-images --uat-smoke-acceptance` | build + ตรวจครบ + push layer ล่วงหน้า (ใช้เมื่อ uplink ช้าหรือเป็น release แรกหลังสร้าง registry ใหม่) |
| `infra/kamal/deploy-uat --profile <p> --apply --prepared-build <run>/build --uat-smoke-acceptance` | deploy UAT; เป้า 600 วินาที, build ที่ไม่ได้เตรียมไว้ไม่เกิน 240 วินาที, หยุดก่อน mutation ถ้างานก่อน mutation เกิน 360 วินาที |
| `infra/kamal/deploy-uat … --uat-browser-acceptance` | ให้เจ้าของล็อกอิน UAT เอง; process ค้างที่ `AWAITING_BROWSER_ACCEPTANCE` |
| `infra/kamal/promote-prod --profile <p> --uat-release <run-dir> --mode normal --production-browser-acceptance --apply` | promote artifact ที่ UAT เซ็นแล้วขึ้น production |
| `infra/kamal/deploy-prod --profile <p> --prepare --production-browser-acceptance` | เตรียม production (ต้องระบุโหมด acceptance แม้แค่ prepare) |
| `infra/kamal/deploy-prod-hotfix --profile <p> --source-sha <sha> --production-baseline <sha> --hotfix-path <path>… --regression-test <spec>… --production-browser-acceptance --apply` | hotfix แยกจาก main โดยไม่ผ่าน UAT |
| `infra/kamal/deploy-{uat,prod} --profile <p> --rollback <operation-id> --apply` | rollback |
| `infra/kamal/deploy-{uat,prod} --profile <p> --reconcile-host-identity [--accept-host-key-rotation --host-key-rotation-reason '…']` | ปรับ host key/address หลังหมุน key โดยตั้งใจ; ไม่ใช่ deployment |

wrapper ทั้งสี่ (`deploy-uat`, `deploy-prod`, `deploy-prod-hotfix`, `promote-prod`) เป็น shell บรรทัดเดียวที่เรียก `release.py` พร้อม environment และ release path ที่ผนึกไว้ — ส่ง `--environment` เพื่อเปลี่ยนคำสั่ง UAT เป็น production ไม่ได้

**สคริปต์ที่เข้าร่วม (`infra/kamal/`, `infra/dev-kamal/`)**

| ไฟล์ | หน้าที่ |
|---|---|
| `infra/kamal/release.py` (1,764 บรรทัด) | ตัวควบคุมหลัก: preflight target, pin `origin/main`, build, ตรวจ config, push/pull, AgentCore, migration, rollout, readback, acceptance, retire, เซ็น KMS, ปิด SSM session; เขียน `.env.kamal/<env>/runs/<operation-id>/result.json` |
| `infra/kamal/release_source.py` | สัญญาของ source และ artifact ที่สองเส้นทาง production ใช้ร่วม (`SERVICES`, `ARTIFACTS`, account, region) |
| `infra/kamal/first_migration.py` | inventory สำหรับ rollback ไป ECS และการส่งต่อ traffic ด้วย CloudFormation change set (ใช้ครั้งเดียว 2026-09-18) |
| `infra/kamal/prepare-production-stack.py` | render stack production เริ่มต้นจาก inventory; ไม่เรียก AWS |
| `infra/kamal/prepare-uat-ssm-transport.py` | patch stack UAT ให้ใช้ SSH ผ่าน SSM; ไม่เรียก AWS |
| `infra/kamal/prepare-bootstrap-update.py` | ฝัง `bootstrap-host.sh` และ SSH public key ลง UserData ของ ApiServer/AiServer |
| `infra/kamal/bootstrap-host.sh` | ตั้ง host Ubuntu ครั้งแรก: Docker (จำกัดขนาด log), path ของ Kamal, proxy ที่ pin digest; ห้ามรันกับ host ที่กำลังให้บริการ |
| `infra/kamal/rehearse-database.py` | ซ้อม migration กับ PostgreSQL ว่างที่สร้างจาก catalog ของ source ที่ deploy อยู่ + ตรวจ runtime ของ image จริงบน Docker network ภายใน |
| `infra/kamal/rehearse-cloud.py` | ซ้อมแกน release บน Dev ที่ลงทะเบียนไว้ ด้วยข้อมูลสังเคราะห์ แล้วปิดเครื่องใน `finally` |
| `infra/kamal/retire-builds.cjs` | รันใน tools image เพื่อ retire build authority เก่าผ่าน audit path เดิม (อ่าน `KAMAL_RETIRE_PROOF`) |
| `infra/kamal/config.json` | การเปลี่ยน environment ที่ track ใน git ต่อ environment/บริการ (`null` = ลบ key); ห้ามใส่ค่า secret |
| `infra/kamal/production-target.example.json` | รายการ field ของ target (ตั้งใจให้ถูกปฏิเสธถ้าใช้ตรง ๆ) |
| `infra/kamal/*_test.py` | `release_test`, `release_paths_test`, `release_source_test`, `first_migration_test`, `first_migration_rehearsal_test`, `production_stack_test`, `shutdown_test`, `stability_test` |
| `infra/dev-kamal/build-complete.py` | build artifact ทุกตัวจาก checkout สะอาดหนึ่งชุด; ไม่ deploy ไม่ push — ใช้ dry run ก่อนขอ MFA |
| `infra/dev-kamal/capture-config.py` | อ่าน config ของ ECS ทั้งหมดลงไฟล์ส่วนตัว เผยเฉพาะ key และ metadata ของ version |
| `infra/dev-kamal/release_inventory.py` | ผูก source/artifact/config ครบชุด และปฏิเสธ readback ที่เก่าหรือไม่ครบ |
| `infra/dev-kamal/verify-config.mjs` | รันใน image candidate ด้วย `--network none` เพื่อตรวจ environment กับ schema (ไม่รับ/ส่งค่า secret) |
| `infra/dev-kamal/Dockerfile.tools` | image เครื่องมือของ dev |
| `infra/ai-gateway/build-agentcore-artifact.sh` | สร้าง archive ของ AgentCore จาก commit เต็ม |
| `infra/ai-gateway/agentcore-deploy.sh`, `validate-agentcore-candidate-binding.sh`, `validate-agentcore-endpoint-readback.sh`, `build-line-ai-release-manifest.sh`, `validate-line-ai-release-manifest.sh`, `select-retirable-agentcore-endpoints.jq` | deploy/ตรวจ AgentCore และ manifest ของ LINE AI (ยุค ECS; ตัวควบคุม Kamal ทำขั้นเดียวกันภายใน) |
| `infra/docker/build-clean-production-image.sh` | build จาก `git archive` ของ commit เดียว พร้อม OCI revision label |
| `infra/docker/verify-production-image.sh` | ตรวจ filesystem สุดท้ายของ image (ไม่มี source/เครื่องมือ dev/secret) |
| `infra/docker/generate-image-sbom.sh` | สร้าง SBOM รูปแบบ SPDX JSON |
| `infra/docker/verify-ecr-scan.sh` + `ecr-scan-blocking-findings.jq` | gate ช่องโหว่ของ ECR (ใช้ใน `ci.yml` เท่านั้น — สาย Kamal ไม่เรียก) |
| `infra/docker/validate-production-manifest.sh`, `validate-production-release-intent.sh`, `validate-uat-deployment-acceptance.sh`, `resolve-production-release-ref.sh`, `resolve-production-fast-mode.sh` | ตัวตรวจของสาย GitHub Actions |
| `infra/docker/api-runtime-smoke.cjs` | smoke ของ image API |

**Target enrollment:** ไฟล์ส่วนตัว `.env.kamal/<environment>/target.json` (mode `0600`, ไม่อยู่ใน git) ระบุ `schemaVersion`, `environment`, `kind`, `account`, `region`, `hosts` ของสามบริการ (instance ID, private IP, VPC, stack, host key), `repository`, `servicePrefix`, `publicUrl`, `apiInternalUrl`, `aiInternalUrl`, `sshKey`, `sshTransport`, `acceptanceCredentials`, `browserAcceptanceUserId`, `agentcoreRuntimeArn`, `agentcoreQualifier`, `agentcoreCandidateQualifier`, `signingKeyArn`, และ (production) `cutoverComplete: true`, `trustedUatSigningKeyArn` ตั้งแต่ 2026-10-09 environment ที่สร้างใหม่ไม่มี ECS ให้อ่าน config จึงต้องลงทะเบียน `.env.kamal/<environment>/config-baseline/<service>.configuration.json` (ค่าธรรมดาและ reference ของ secret; ไม่มีค่า secret)

**เครื่องมือที่เครื่องผู้ปฏิบัติงานต้องมี:** Git, Python 3, pnpm, Node, Docker ที่ build linux/amd64 ได้, AWS CLI, Session Manager plugin, SSH และ principal ที่ไม่ใช่ root ซึ่งมีสิทธิ์ EC2/ECS discovery, ECR, Secrets Manager read, AgentCore runtime/endpoint, S3 artifact แบบมี version และ KMS sign/verify

### 2.2 การเซ็นด้วย KMS และหลักฐาน release

- UAT และ Production เซ็นและตรวจ `accepted.json` ด้วย KMS asymmetric key ของ environment ตัวเอง; dev บันทึก checksum ที่ไม่เซ็น
- ผลสำเร็จคือ `ACCEPTED_LINE_DEFERRED` ("LINE deferred" = ไม่ได้ทดลองคุย LINE จริงใน release) ผลอื่นที่เคยเซ็น: `OWNER_ACCEPTED_BROWSER_HTTP_WAIVED`, `ACCEPTED_WITH_BROWSER_HTTP_WAIVER` (2026-09-18), `RESTORED_UAT_OPEN_SMOKE_ACCEPTED`, `OWNER_ACCEPTED_WITH_EXISTING_EMAIL_ALARM` (2026-10-09), `ROLLED_BACK_TO_ECS` (นิยามไว้ ไม่เคยใช้)
- Browser acceptance เป็น `operator_browser_attestation`: ตัวควบคุมผูก operation/source/origin/account และ hash ไฟล์หลักฐาน แต่ไม่ได้ยืนยันตัวตนผู้สังเกตเอง ต้องผ่านครบ 6 ข้อ (ตัวตนที่คาด, SYSTEM_ADMIN + `system.launch_gate.manage`, ลูกค้า `OPEN`, หน้าระบบที่ต้อง auth, logout, session ที่ logout แล้วถูกปฏิเสธ)
- ทุก run เก็บ run directory ส่วนตัว (config ที่ resolve แล้ว, environment ก่อนหน้า, request ของ provider) สำหรับ reconcile/rollback — ห้ามเผยแพร่
- บันทึกทุก release ลง `docs/runbooks/cloud-environment-operations.md` พร้อม operation ID ของ prepare/apply, เวลา, จำนวน phase; workflow ID ของ UAT/READY/PROD เขียน `NOT_DISPATCHED`
- การเซ็นใช้ไม่ได้อีกแล้ว: key ทั้งสองอยู่ใน `PendingDeletion` (หัวข้อ 9)

### 2.3 สาย V2 ผ่าน GitHub Actions (`docs/runbooks/uat-production-v2-deployment.md`)

| ขั้น | Workflow | ผลที่ต้องได้ |
|---|---|---|
| A. UAT | `deploy-uat.yml` (`release_ref=<SHA ของ PR head ที่ CI ผ่าน>`, `target=all`) | image ไม่เปลี่ยนรูป 3 ตัว + `release-task` + `migration-tool` พร้อมลายเซ็น/SBOM; signed Passport `uat-release-passport-v2-<candidate>-attempt-<n>` |
| B. READY | `production-readiness.yml` (อัตโนมัติหลัง UAT `all`) | ทุก check `PASS`, signed READY; ถ้ามี migration ค้างต้อง clone/ซ้อมและล้าง resource เหลือศูนย์ |
| C. Production ปิดลูกค้า | `deploy-production-v2.yml` (`requested_serving_mode=maintenance_closed`) | `PROMOTED_CLOSED`, maintenance proof `DEPLOYED_NOT_LAUNCHED` |
| D. Production เปิดลูกค้า | READY ใหม่ด้วย `requested_serving_mode=live` + `owner_legal_override_ref` แล้ว promote | `PROMOTED_LIVE` |
| E. เปิด gate | ผู้ดูแลปัจจุบัน PUT `state=OPEN` ที่ `/api/v1/system/platform-access` แล้วตรวจ `/api/v1/auth/platform-access` = `OPEN`, `/login` มี `data-platform-access="open"`, logout 204, `auth/me` 401 | release live เสร็จจริงเมื่อขั้น E ครบ |

กติกาบังคับ 6 ข้อของ protocol: ใช้ SHA ของ PR head ที่ CI ผ่านเพื่อ reuse CI; พิสูจน์ว่าไม่มี run ซ้อนและจด run ID; freeze `main` ตั้งแต่ READY จนจบ; production ใช้ digest เดิมห้าม rebuild; ล้มแล้วหยุดที่ขอบเขตแรก; `PROMOTED_LIVE` ยังไม่เท่ากับลูกค้าใช้ได้จนกว่า gate เป็น `OPEN` Passport และ READY อายุไม่เกิน 24 ชั่วโมง Release ledger ขั้นต่ำ: `candidate`, `controller`, `UAT_RUN_ID`, `READY_RUN_ID`, `PROD_RUN_ID`, digest ของ artifact, serving mode, หลักฐานกฎหมาย/การอ้างอิงเจ้าของ, ผล acceptance สุดท้าย

ตารางตัดสิน "ต้อง deploy หรือไม่": แก้เฉพาะ `docs/**` ที่ไม่เข้า image → ไม่ต้อง; แก้ workflow/controller เท่านั้น → READY ใหม่; แก้แอป/Dockerfile/dependency/migration/config contract → UAT ใหม่ทั้งสาย; แก้ IAM/network/S3 → prerequisite ceremony (`production-promotion-prerequisite-bootstrap.md`) ก่อน

กฎ billing policy: `parseBillingPolicy` ปฏิเสธ key ที่ไม่รู้จัก และ policy ที่ parse ไม่ผ่านทำให้ปิดการซื้อของทุกร้าน จึงเผยแพร่ policy ที่มี key ใหม่ได้เฉพาะเมื่อ binary ที่อ่าน key นั้นขึ้นครบทั้ง UAT และ Production (เช่น `addOnPriceIds` ต้องมี migration `20260929120000_billing_product_foundation`)

### 2.4 Hotfix

`infra/kamal/deploy-prod-hotfix` ปล่อยจาก source ที่ pin บนฐาน production โดยไม่นำ backlog ของ main มา:

- ต้องระบุ `--hotfix-path` ครบ **ทุก** path ที่เปลี่ยน และ `--regression-test` ของ spec ที่เกี่ยว (spec ใต้ `src` ที่เปลี่ยนทุกไฟล์ต้องอยู่ในรายการ; hotfix ที่แก้แต่รูปยังต้องระบุ spec ที่มีอยู่อย่างน้อยหนึ่ง)
- path ที่อนุญาต: `docs/`, `src/**/*.{ts,tsx,js,jsx,css}` ของสี่แอปและ `packages/contracts`, `e2e/**/*.spec.ts`, รูป raster ใต้ `apps/web/public/assets/` (`png`, `jpg`, `jpeg`, `webp`; ไม่รับ `svg`)
- ปฏิเสธการเปลี่ยน schema/dependency/build/controller; ปฏิเสธเมื่อมี migration ที่ยังไม่ apply; build image ทั้งหมดใหม่จาก source ที่ pin; คง config ที่กำลังให้บริการ
- ใช้จริง: 2026-09-18 (สอง hotfix), 2026-09-30 (constraint ของ signup และโปสเตอร์โปรโมชัน, บรรทัดใบเบิกบนมือถือ)

### 2.5 Rollback

| กรณี | วิธี | ขอบเขต |
|---|---|---|
| Hotfix ที่ไม่มี migration | `--rollback <terminal-operation-id> --apply` ใช้ container เดิมที่เก็บไว้และ environment ครบชุด, คืน route, ตรวจ image/config/health/การเข้าถึงของลูกค้า แล้วเซ็น | **ไม่ใช่ down-migration ของฐานข้อมูล**; หยุดถ้า container เดิมหาย, host เปลี่ยน, หรือ provider endpoint เปลี่ยน |
| Release ที่มี migration | ไม่มี rollback อัตโนมัติ; migration ต้อง additive และเดินหน้าแก้ | — |
| ผลไม่ทราบ/ล้มกลางทาง | `active.json` และ lock ระยะไกลถูกคงไว้; deploy ครั้งถัดไปปฏิเสธ; ต้องอ่าน result เดิม, reconcile สถานะ cloud จริง แล้ว retry ที่ review แล้ว — ห้ามลบ lock เพื่อไปต่อ | ไม่มี retry อัตโนมัติ |
| Cloudflare Worker | คืนเป็น version ก่อนหน้าที่บันทึกไว้ | เฉพาะ edge |
| AgentCore | endpoint เดิมยังชี้ version เดิมเสมอ; release ใช้ endpoint สำรอง ไม่ repoint ตัวที่ให้บริการอยู่ | — |
| ECS ↔ Kamal | ขั้นตอน `ROLLED_BACK_TO_ECS` มีเฉพาะ orchestration test ในเครื่อง ไม่เคยซ้อมจริง และหน้าต่างปิดแล้วตั้งแต่ 2026-09-18 | ประวัติ |

### 2.6 สคริปต์ยุค ECS Express และ ceremony (`infra/prod-ecs-express/`, `infra/uat/`, `infra/security/`, `infra/production/`)

ไม่ถูกใช้หลังย้ายเป็น Kamal แต่อยู่ใน archive และ workflow ยังอ้างถึง:

| กลุ่ม | ไฟล์หลัก | หน้าที่ |
|---|---|---|
| Deploy ECS | `infra/prod-ecs-express/deploy.sh`, `verify-deployment.sh`, `run-release-task.sh`, `run-task-idempotently.sh`, `register-task-definition-with-retry.sh`, `lib-rollout-waves.sh`, `lib-uat-fast-rollout.sh`, `lib-prod-rollout-config.sh`, `lib-wait-for-service-url.sh`, `bind-express-create.sh`, `bind-express-deployment.sh`, `verify-express-noop.sh`, `verify-serving-api-build.sh` | deploy สามบริการเป็นคลื่น, รัน release task (migration/sync) แบบ idempotent, ตรวจหลัง deploy |
| Maintenance / กู้ | `verify-production-maintenance.sh`, `wait-production-maintenance-ingress-drain.sh`, `recover-production-minimum-capacity.sh`, `cleanup-one-shot-task.sh`, `retirement-evidence.sh`, `active-launch-builds.sh`, `active-release-tasks.sh`, `list-service-deployments-all.sh`, `logs.sh` | โหมดปิดปรับปรุง, กู้ความจุขั้นต่ำ, เก็บหลักฐาน retire |
| Policy | `*-policy.template.json`, `*-trust.template.json` | IAM ของ deploy role (OIDC ของ GitHub) |
| UAT | `infra/uat/setup-control-plane.sh`, `bootstrap-data.sh`, `deploy-with-runtime-mutex.sh`, `lib-runtime-mutex.sh`, `verify-deploy-readiness.sh`, `select-deploy-target.sh`, `redis-blue-green.sh`, `db-port-forward.sh`, `m01-actor-delegation-alert.sh`, `m14-upload-alert.sh`, `run-a5-capacity-mutating.sh`, `validate-u5-capacity-*.sh`, `build-u5-capacity-workload-manifest.sh`, `bootstrap-a5-readonly.sh`, `verify-control-plane-policies.sh` | control plane ของ UAT, mutex ระหว่าง deploy กับ Redis, ย้าย Redis แบบ blue-green ไปตัวเข้ารหัส, หลักฐานความจุ |
| Production bootstrap | `infra/production/bootstrap-data.sh` (สร้าง Redis production แบบเข้ารหัสและ bastion), `bootstrap-support-roles.sql`, `arm-support-execute.sh`, `inspect-migration-state.sh`, `compare-env-keys.sh`, `security-alert-rules.md`, policy template | data plane และการเข้าถึงเพื่อ support |
| A5/U5/V2 evidence | `infra/security/bootstrap-production-*.sh`, `collect-production-*.sh`, `capture-production-a5-live-state.sh`, `fetch-verified-*.sh`, `compare-production-ready-baseline-v2.sh`, `evidence-contracts.jq`, `sync-production-maintenance-release-pins.mjs`, `validate-legal-release-readiness.sh`, `validate-production-*.sh`, `verify-production-security-baseline.sh`, `post-restore-re-erasure.sh`, policy/trust template จำนวนมาก | หลักฐานเซ็นของ ceremony, pin ของนโยบาย maintenance, gate เอกสารกฎหมาย, การลบซ้ำหลัง restore |
| Monitoring | `infra/monitoring/runtime-alarms.sh` | ติดตั้ง/ตรวจ alarm (หัวข้อ 5) |
| Postmark | `infra/postmark/config.py`, `config.json` | ตรวจ/ประกอบ config อีเมลต่อ environment |
| Official OA | `infra/line-official/build.py`, `handler.cjs` | Lambda ของ OA ทางการ (ปลดระวาง) |
| Support | `infra/support/connect-production.sh` | ทางเข้าเดียวสู่ production support (หัวข้อ 4) |

`pin` ของนโยบาย maintenance: ไฟล์ที่ถูก guard (เช่น Dockerfile, auth guard, ถ้อยคำบางชุด) มี hash บันทึกไว้ การแก้ไฟล์เหล่านี้ต้องรัน `node infra/security/sync-production-maintenance-release-pins.mjs` (หรือ `bash scripts/local-proof/repin.sh`) แล้วอ่าน diff ก่อน commit มิฉะนั้น gate `--check` ล้ม

---

## 3. Configuration reference — environment variable และ secret ทุกตัว

### 3.1 วิธีอ่านและที่มา

- **แหล่งความจริง:** `packages/config/src/index.ts` นิยาม schema (zod) สี่ชุด — `apiConfigSchema`, `aiGatewayConfigSchema`, `webConfigSchema`, `workersConfigSchema` — ต่อยอดจาก `baseConfigSchema` รวม **233 ชื่อ** และ `validateProductionConfig` บังคับกฎเพิ่มเมื่อ `APP_ENV=production` ตารางในหัวข้อ 3.2 สร้างจาก schema นี้โดยตรง
- **คอลัมน์ "รูปแบบ / ค่าเริ่มต้น":** ค่าเริ่มต้นที่แสดงเป็นค่าในโค้ดของตัวแปรที่ไม่ใช่ secret เท่านั้น ตัวที่ติดป้าย **secret** แสดงเฉพาะรูปแบบ ไม่มีค่า
- **คอลัมน์ "เงื่อนไข":** "ไม่บังคับ" = schema ให้เว้นได้หรือมีค่าเริ่มต้น; ข้อความอื่นคือกฎจาก `validateProductionConfig`
- **กฎของ secret ใน production:** secret ที่ repo สร้างเองต้องยาวอย่างน้อย 32 ตัวอักษร, ของบุคคลที่สามอย่างน้อย 16, ห้ามใช้ค่าตัวอย่างที่ commit ไว้ และต้องมี entropy พอ; ข้อความ error ระบุชื่อ key เท่านั้น ไม่พิมพ์ค่า
- **ที่มาของค่าใน cloud:** baseline ของ environment (เดิมอ่านจาก ECS, ตั้งแต่ 2026-10-09 จาก `.env.kamal/<env>/config-baseline/`) + secret version ปัจจุบันจาก Secrets Manager + การเปลี่ยนที่ track ใน `infra/kamal/config.json`; ตัวควบคุมเปรียบเทียบ environment ทั้งชุดของ container ใหม่ รวม key ที่เหลือค้างโดยไม่คาดคิด
- **ตัวตรวจก่อน deploy:** `pnpm config:validate <ไฟล์ env> [--service <ชื่อ>]` (`scripts/validate-prod-config.ts`) และ `infra/dev-kamal/verify-config.mjs` ที่รันใน image จริง
- **ไฟล์ตัวอย่าง:** `.env.example` (157 ชื่อ) ครอบคลุม local; schema มี 96 ชื่อที่ไม่อยู่ใน `.env.example` เพราะมีค่าเริ่มต้น

### 3.2 ตัวแปรใน schema (233 ตัว)

#### 3.2.1 พื้นฐานทุกบริการ (11 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `APP_ENV` | ทุกบริการ | โหมดความปลอดภัยของ process | local \| production | จำเป็นทุกที่ |
| `DEPLOY_ENVIRONMENT` | ทุกบริการ | ตัวตนของ deployment ที่ launch control บันทึก | local \| uat \| production; เริ่มต้น `local` | จำเป็นใน production (`uat`/`production`) |
| `NODE_ENV` | ทุกบริการ | โหมดของ Node | development \| test \| production; เริ่มต้น `development` | ไม่บังคับ |
| `SERVICE_NAME` | ทุกบริการ | ชื่อบริการใน log/health | ข้อความ | จำเป็นทุกที่ |
| `SERVICE_VERSION` | ทุกบริการ | เวอร์ชันที่รายงาน | ข้อความ | จำเป็นใน production |
| `GIT_SHA` | ทุกบริการ | build id ไม่เปลี่ยนรูป (commit เต็ม) | ข้อความ | จำเป็นใน production (หรือ `IMAGE_DIGEST`) |
| `IMAGE_DIGEST` | ทุกบริการ | build id แบบ digest ของ image | ข้อความ | ทางเลือกแทน `GIT_SHA` |
| `HOST` | ทุกบริการ | address ที่ bind | ข้อความ; เริ่มต้น `127.0.0.1` | ไม่บังคับ |
| `PORT` | ทุกบริการ | port ที่ฟัง | ตัวเลข; เริ่มต้น `3000` | ไม่บังคับ |
| `PUBLIC_BASE_URL` | ทุกบริการ | URL สาธารณะของบริการ | URL | จำเป็นใน production |
| `TRUST_PROXY` | ทุกบริการ | เชื่อ header จาก proxy เพื่อหา IP ผู้ใช้ | boolean (`true`/`false`) | ไม่บังคับ |

#### 3.2.2 ฐานข้อมูล, Redis, object storage, อัปโหลด (20 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `DATABASE_URL` | api, workers | connection string ของ PostgreSQL | ข้อความ — **secret** | จำเป็น (หรือ `DATABASE_SECRET_ARN`); production ห้ามชี้ localhost |
| `DATABASE_SECRET_ARN` | api | ARN ของ secret ที่เก็บ connection string | ข้อความ — **secret** | ทางเลือกแทน `DATABASE_URL` |
| `DATABASE_POOL_MIN` | api | ขนาด pool ต่ำสุด | ตัวเลข; เริ่มต้น `1` | ไม่บังคับ |
| `DATABASE_POOL_MAX` | api | ขนาด pool สูงสุด | ตัวเลข; เริ่มต้น `10` | ไม่บังคับ |
| `DATABASE_STATEMENT_TIMEOUT_MS` | api | timeout ของ statement | ตัวเลข; เริ่มต้น `10000` | ไม่บังคับ |
| `REDIS_URL` | api, workers | connection string ของ Redis (rate limit, queue, LINE ledger) | ข้อความ — **secret** | จำเป็นใน production; ห้ามชี้ localhost |
| `S3_BUCKET` | api, workers | bucket ของไฟล์แนบ | ข้อความ | จำเป็น |
| `S3_REGION` | api, workers | region ของ bucket | ข้อความ; เริ่มต้น `ap-southeast-1` | ไม่บังคับ |
| `S3_ENDPOINT` | api, workers | endpoint ของ MinIO ใน local | ข้อความ | local เท่านั้น — production ห้ามตั้ง |
| `S3_PUBLIC_ENDPOINT` | api | endpoint ที่เบราว์เซอร์ใช้กับ MinIO ใน local | ข้อความ | ไม่บังคับ |
| `S3_FORCE_PATH_STYLE` | api, workers | ใช้ path-style (MinIO) | boolean (`true`/`false`) | ไม่บังคับ |
| `S3_ACCESS_KEY_ID` | api, workers | access key ของ MinIO ใน local (cloud ใช้ IAM role) | ข้อความ | ไม่บังคับ |
| `S3_SECRET_ACCESS_KEY` | api, workers | secret key ของ MinIO ใน local | ข้อความ — **secret** | ไม่บังคับ |
| `UPLOAD_MAX_BYTES` | api | ขนาดไฟล์อัปโหลดสูงสุด | ตัวเลข; เริ่มต้น `10485760` | ไม่บังคับ |
| `UPLOAD_PENDING_MAX_BYTES_PER_COMPANY` | api | ปริมาณไฟล์ค้างยืนยันต่อบริษัท | ตัวเลข; เริ่มต้น `104857600` | ไม่บังคับ |
| `ALLOWED_UPLOAD_MIME_TYPES` | api | ชนิดไฟล์ที่รับ | ข้อความ; เริ่มต้น `application/pdf,image/png,image/jpeg` | ไม่บังคับ |
| `CLAMAV_HOST` | api | host ของ clamd สำหรับสแกนไฟล์ | ข้อความ | จำเป็นใน production (API) |
| `CLAMAV_PORT` | api | port ของ clamd | ตัวเลข; เริ่มต้น `3310` | ไม่บังคับ |
| `CLAMAV_TIMEOUT_MS` | api | timeout การสแกน | ตัวเลข; เริ่มต้น `5000` | ไม่บังคับ |
| `SIGNED_URL_TTL_SECONDS` | api | อายุ signed URL (สูงสุด 300) | ตัวเลข; เริ่มต้น `300` | ไม่บังคับ |

#### 3.2.3 HTTP, rate limit, log, audit (17 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | api, ai-gateway | origin ที่อนุญาต | ข้อความ; เริ่มต้นว่าง | production ต้องเป็น allowlist ที่ไม่ว่างและไม่มี `*` |
| `HTTP_BODY_LIMIT` | api, ai-gateway | ขนาด body สูงสุด | ข้อความ; เริ่มต้น `1mb` | ไม่บังคับ |
| `SWAGGER_ENABLED` | api, ai-gateway | เปิด OpenAPI UI | boolean (`true`/`false`); เริ่มต้น `false` | production ต้อง `false` |
| `RATE_LIMIT_ENABLED` | api, ai-gateway | เปิด rate limit กลาง | boolean (`true`/`false`); เริ่มต้น `false` | production API ต้อง `true` |
| `RATE_LIMIT_WINDOW_SECONDS` | api | หน้าต่าง rate limit | ตัวเลข; เริ่มต้น `60` | จำเป็นใน production |
| `RATE_LIMIT_MAX_REQUESTS` | api | จำนวน request ต่อหน้าต่าง | ตัวเลข; เริ่มต้น `120` | จำเป็นใน production |
| `REIMBURSEMENT_WRITE_QUIESCE` | api | หยุดการเขียนใบเบิกชั่วคราวระหว่าง migration | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `PRODUCTION_SERVING_MODE` | api, workers | โหมดให้บริการ (ปกติ/ปิดปรับปรุง) | live \| maintenance_only | workers ใน production ต้องเป็น `live` หรือ `maintenance_only` |
| `REQUIRE_COMPANY_CONTEXT` | api | บังคับ header บริษัท | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `COMPANY_CONTEXT_HEADER` | api | ชื่อ header บริษัท | ข้อความ; เริ่มต้น `X-Company-Id` | ไม่บังคับ |
| `LOG_LEVEL` | api, ai-gateway, workers | ระดับ log | debug \| info \| warn \| error; เริ่มต้น `info` | production ห้าม `debug` |
| `LOG_FORMAT` | api, ai-gateway, workers | รูปแบบ log | text \| json; เริ่มต้น `json` | production ต้องเป็น `json` |
| `LOG_REDACTION_ENABLED` | api, ai-gateway, workers | ปิดบังค่าอ่อนไหวใน log | boolean (`true`/`false`); เริ่มต้น `true` | production ต้อง `true` |
| `REQUEST_LOG_ENABLED` | api | log ทุก request | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `SQL_LOG_ENABLED` | api | log SQL | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `AUDIT_ENABLED` | api | เปิด audit trail | boolean (`true`/`false`); เริ่มต้น `true` | production ต้อง `true` |
| `AUDIT_SINK` | api | ที่เก็บ audit | database; เริ่มต้น `database` | ไม่บังคับ |

#### 3.2.4 Auth, session, JWT, key เข้ารหัส และ rate limit ของ auth (38 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `AUTH_PROVIDER` | api | ผู้ให้บริการ auth | line \| dev; เริ่มต้น `dev` | production ห้าม `dev` |
| `DEV_AUTH_ENABLED` | api | เปิด dev login | boolean (`true`/`false`); เริ่มต้น `false` | production ต้อง `false` |
| `DEV_AUTH_SECRET` | api, ai-gateway | secret ของ dev token | ข้อความ — **secret** | production ห้ามตั้ง |
| `SEED_SYSTEM_ADMIN_PASSWORD` | api | รหัสผ่านผู้ดูแลตอน seed (local) | ข้อความ — **secret** | production ห้ามตั้ง |
| `WEB_BASE_URL` | api | URL ของเว็บสำหรับสร้างลิงก์ | URL | ต้องเป็น HTTPS เมื่อเปิด Official OA; จำเป็นเมื่อใช้ SES |
| `WORKER_INTERNAL_TOKEN` | api, workers | token ของ route `/v1/internal/*` ที่ workers เรียก | ข้อความ — **secret** | จำเป็นใน production (API และ workers) |
| `AI_GATEWAY_INTERNAL_URL` | api | URL ภายในของ AI Gateway | URL; เริ่มต้น `http://localhost:3002` | ไม่บังคับ |
| `AI_GATEWAY_INTERNAL_SECRET` | api, ai-gateway | secret ระหว่าง API กับ gateway | ข้อความ — **secret** | จำเป็นใน production (API และ gateway) |
| `AI_ACTOR_DELEGATION_SIGNING_KEY` | api | key เซ็นการมอบสิทธิ์ผู้ใช้ให้เครื่องมือ AI (M-01) | hex 64 ตัวอักษร — **secret** | จำเป็นใน production (API); ต้องไม่ซ้ำ key อื่น |
| `WATCHDOG_JWT_ISSUER` | api, ai-gateway | issuer ของ JWT | ข้อความ | จำเป็นใน production |
| `WATCHDOG_JWT_AUDIENCE` | api, ai-gateway | audience ของ JWT | ข้อความ | จำเป็นใน production |
| `WATCHDOG_JWT_SECRET_ARN` | api, ai-gateway | ที่มาของ key เซ็น session/JWT | ข้อความ — **secret** | จำเป็นใน production (API; gateway เว้นได้) |
| `JWT_CLOCK_TOLERANCE_SECONDS` | api, ai-gateway | ความคลาดเคลื่อนของนาฬิกาที่ยอมรับ | ตัวเลข; เริ่มต้น `30` | ไม่บังคับ |
| `PASSWORD_LOGIN_MAX_PER_IDENTIFIER` | api | จำกัดอัตราการล็อกอินด้วยรหัสผ่าน | ตัวเลข — **secret** | ไม่บังคับ |
| `PASSWORD_LOGIN_MAX_PER_IP` | api | จำกัดอัตราการล็อกอินด้วยรหัสผ่าน | ตัวเลข — **secret** | ไม่บังคับ |
| `PASSWORD_LOGIN_WINDOW_SECONDS` | api | จำกัดอัตราการล็อกอินด้วยรหัสผ่าน | ตัวเลข — **secret** | ไม่บังคับ |
| `SESSION_REFRESH_MAX_PER_SESSION` | api | จำกัดอัตราและ grace ของการ refresh session | ตัวเลข; เริ่มต้น `30` | ไม่บังคับ |
| `SESSION_REFRESH_WINDOW_SECONDS` | api | จำกัดอัตราและ grace ของการ refresh session | ตัวเลข; เริ่มต้น `60` | ไม่บังคับ |
| `SESSION_REFRESH_REUSE_GRACE_SECONDS` | api | จำกัดอัตราและ grace ของการ refresh session | ตัวเลข; เริ่มต้น `30` | ไม่บังคับ |
| `PASSWORD_RESET_REQUEST_MAX_PER_IDENTIFIER` | api | จำกัดอัตรา/เวลาตอบของการรีเซ็ตรหัสผ่าน | ตัวเลข — **secret** | ไม่บังคับ |
| `PASSWORD_RESET_REQUEST_MAX_PER_IP` | api | จำกัดอัตรา/เวลาตอบของการรีเซ็ตรหัสผ่าน | ตัวเลข — **secret** | ไม่บังคับ |
| `PASSWORD_RESET_REQUEST_WINDOW_SECONDS` | api | จำกัดอัตรา/เวลาตอบของการรีเซ็ตรหัสผ่าน | ตัวเลข — **secret** | ไม่บังคับ |
| `PASSWORD_RESET_CONFIRM_MAX_PER_IP` | api | จำกัดอัตรา/เวลาตอบของการรีเซ็ตรหัสผ่าน | ตัวเลข — **secret** | ไม่บังคับ |
| `PASSWORD_RESET_CONFIRM_WINDOW_SECONDS` | api | จำกัดอัตรา/เวลาตอบของการรีเซ็ตรหัสผ่าน | ตัวเลข — **secret** | ไม่บังคับ |
| `PASSWORD_RESET_RESPONSE_MIN_MS` | api | จำกัดอัตรา/เวลาตอบของการรีเซ็ตรหัสผ่าน | ตัวเลข — **secret** | ไม่บังคับ |
| `CUSTOMER_REGISTER_MAX_PER_IP_CHANNEL` | api | จำกัดอัตราการลงทะเบียนลูกค้า (CRM) | ตัวเลข; เริ่มต้น `10` | ไม่บังคับ |
| `CUSTOMER_REGISTER_WINDOW_SECONDS` | api | จำกัดอัตราการลงทะเบียนลูกค้า (CRM) | ตัวเลข; เริ่มต้น `900` | ไม่บังคับ |
| `EMAIL_VERIFICATION_REQUEST_MAX_PER_USER` | api | จำกัดอัตราการยืนยันอีเมล | ตัวเลข; เริ่มต้น `3` | ไม่บังคับ |
| `EMAIL_OTP_HMAC_KEY` | api | key ของ OTP อีเมล | hex 64 ตัวอักษร — **secret** | ไม่บังคับ |
| `EMAIL_OTP_HMAC_KEY_VERSION` | api | ป้ายเวอร์ชันของ key OTP | ข้อความ | ไม่บังคับ |
| `EMAIL_VERIFICATION_REQUEST_WINDOW_SECONDS` | api | จำกัดอัตราการยืนยันอีเมล | ตัวเลข; เริ่มต้น `900` | ไม่บังคับ |
| `EMAIL_VERIFICATION_CONFIRM_MAX_PER_IP` | api | จำกัดอัตราการยืนยันอีเมล | ตัวเลข; เริ่มต้น `10` | ไม่บังคับ |
| `EMAIL_VERIFICATION_CONFIRM_WINDOW_SECONDS` | api | จำกัดอัตราการยืนยันอีเมล | ตัวเลข; เริ่มต้น `900` | ไม่บังคับ |
| `CREDENTIAL_ENCRYPTION_KEY` | api | key เข้ารหัส credential ของ LINE OA ร้าน ฯลฯ | hex 64 ตัวอักษร — **secret** | จำเป็นใน production (API) |
| `PDPA_PSEUDONYMIZATION_KEY` | api | key ทำ pseudonym ตาม PDPA | hex 64 ตัวอักษร — **secret** | จำเป็นใน production (API); ต้องต่างจาก `CREDENTIAL_ENCRYPTION_KEY` |
| `PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS` | api | key เก่าระหว่างการหมุน | hex 64 ตัวอักษร — **secret** | ไม่บังคับ |
| `ERP_CORE_INTERNAL_URL` | ai-gateway | URL ภายในของ ERP API | URL; เริ่มต้น `http://localhost:3001/v1` | ไม่บังคับ |
| `INTERNAL_API_URL` | workers | URL ของ API ที่ workers/web server เรียก | URL; เริ่มต้น `http://localhost:3001/v1` | ไม่บังคับ |

#### 3.2.5 LINE Login, LIFF, Messaging API, สมัครผ่าน LINE (31 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `LINE_LOGIN_CHANNEL_ID` | api | channel ของ LINE Login | ข้อความ | จำเป็นใน production (API) |
| `LINE_LOGIN_CHANNEL_SECRET` | api | secret ของ LINE Login | ข้อความ — **secret** | จำเป็นใน production (API) |
| `LINE_WEB_LOGIN_ENABLED` | api | เปิดล็อกอินเว็บด้วย LINE | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `EXTERNAL_SIGNUP_ENABLED` | api | เปิดสมัครร้านจากภายนอก | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_WEB_HANDOFF_ENABLED` | api | เปิดลิงก์ส่งต่อ LINE → เว็บ | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_SIGNUP_ENABLED` | api | เปิดสมัครผ่าน LINE | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_SIGNUP_APPROVAL_MODE` | api | อนุมัติสมัครด้วยมือหรืออัตโนมัติ (ฟรี) | MANUAL \| AUTO_FREE; เริ่มต้น `MANUAL` | ไม่บังคับ |
| `LINE_SIGNUP_AUTO_DAILY_CAP` | api | เพดานอนุมัติอัตโนมัติต่อวัน | ตัวเลข; เริ่มต้น `20` | ไม่บังคับ |
| `LINE_SIGNUP_WARMUP_SLIPS` | api | จำนวนสลิปช่วงเริ่มใช้ | ตัวเลข; เริ่มต้น `15` | ไม่บังคับ |
| `LINE_FREE_AI_BUDGET_SATANG` | api | งบ AI ของร้านฟรี (สตางค์) | ตัวเลข; เริ่มต้น `8000` | ไม่บังคับ |
| `LINE_SIGNUP_ADMIN_REMINDER_MINUTES` | api | รอบเตือนผู้ดูแลเรื่องคำขอสมัคร | ตัวเลข; เริ่มต้น `60` | ไม่บังคับ |
| `LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY` | api | เพดานการแจ้งเตือนงบหมดต่อวัน | ตัวเลข; เริ่มต้น `5` | ไม่บังคับ |
| `AI_CREDIT_HOLD_ALERT_AFTER_HOURS` | api | ชั่วโมงก่อนแจ้งเตือน hold เครดิตค้าง | ตัวเลข; เริ่มต้น `24` | ไม่บังคับ |
| `LINE_SIGNUP_BUSINESS_DAYS` | api | วันทำการของทีมอนุมัติ | `DDD-DDD`; เริ่มต้น `MON-SAT` | ไม่บังคับ |
| `LINE_SIGNUP_BUSINESS_HOURS` | api | เวลาทำการของทีมอนุมัติ | `HH:MM-HH:MM`; เริ่มต้น `09:00-18:00` | ไม่บังคับ |
| `RECEIPT_QUOTA_ENFORCED` | api | บังคับโควตาใบเสร็จตามแพ็ก | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_LIFF_ID` | api | LIFF app id | ข้อความ | จำเป็นใน production (API) |
| `LINE_MESSAGING_CHANNEL_ID` | api | channel ของ Messaging API (OA ระบบ) | ข้อความ | จำเป็นใน production (API) |
| `LINE_MESSAGING_CHANNEL_SECRET` | api | secret ตรวจลายเซ็น webhook | ข้อความ — **secret** | จำเป็นใน production (API) |
| `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` | api | token ส่งข้อความ | ข้อความ — **secret** | จำเป็นใน production (API) |
| `LINE_OFFICIAL_REPLY_ENABLED` | api | ให้ ERP ตอบแทน OA ทางการ | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_OFFICIAL_CHANNEL_SECRET` | api | secret ของ OA ทางการ | ข้อความ — **secret** | จำเป็นเมื่อ `LINE_OFFICIAL_REPLY_ENABLED=true` |
| `LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN` | api | token ของ OA ทางการ | ข้อความ — **secret** | จำเป็นเมื่อ `LINE_OFFICIAL_REPLY_ENABLED=true` |
| `LINE_LOGIN_CALLBACK_MAX_PER_IP` | api | จำกัดอัตรา callback ของ LINE Login | ตัวเลข; เริ่มต้น `10` | ไม่บังคับ |
| `LINE_LOGIN_CALLBACK_WINDOW_SECONDS` | api | จำกัดอัตรา callback ของ LINE Login | ตัวเลข; เริ่มต้น `900` | ไม่บังคับ |
| `LINE_QR_CREATE_MAX_PER_IP` | api | จำกัดอัตราการสร้าง/poll QR ล็อกอิน | ตัวเลข; เริ่มต้น `10` | ไม่บังคับ |
| `LINE_QR_CREATE_WINDOW_SECONDS` | api | จำกัดอัตราการสร้าง/poll QR ล็อกอิน | ตัวเลข; เริ่มต้น `300` | ไม่บังคับ |
| `LINE_QR_POLL_MAX_PER_IP` | api | จำกัดอัตราการสร้าง/poll QR ล็อกอิน | ตัวเลข; เริ่มต้น `90` | ไม่บังคับ |
| `LINE_QR_POLL_WINDOW_SECONDS` | api | จำกัดอัตราการสร้าง/poll QR ล็อกอิน | ตัวเลข; เริ่มต้น `60` | ไม่บังคับ |
| `LINE_HANDOFF_EXCHANGE_MAX_PER_IP` | api | จำกัดอัตราการแลก handoff token | ตัวเลข; เริ่มต้น `20` | ไม่บังคับ |
| `LINE_HANDOFF_EXCHANGE_WINDOW_SECONDS` | api | จำกัดอัตราการแลก handoff token | ตัวเลข; เริ่มต้น `60` | ไม่บังคับ |

#### 3.2.6 LINE AI (API และ gateway) (46 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `LINE_AI_RELIABILITY_V2_MODE` | api, ai-gateway | โหมด/ขอบเขต rollout ของ reliability v2 | off \| shadow \| on; เริ่มต้น `on` | ไม่บังคับ |
| `LINE_AI_RELIABILITY_V2_COMPANY_IDS` | api, ai-gateway | โหมด/ขอบเขต rollout ของ reliability v2 | รายการ ID คั่นด้วยจุลภาค (ว่าง = ไม่จำกัด) | ไม่บังคับ |
| `LINE_AI_DELIVERY_PLAN_V2_ENABLED` | api, ai-gateway | แผนการส่งคำตอบ v2 และขอบเขต rollout | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_DELIVERY_PLAN_V2_WRITE_COMPANY_IDS` | api, ai-gateway | แผนการส่งคำตอบ v2 และขอบเขต rollout | รายการ ID คั่นด้วยจุลภาค (ว่าง = ไม่จำกัด) | ไม่บังคับ |
| `LINE_AI_DELIVERY_PLAN_V2_PUBLIC_CHANNEL_IDS` | api, ai-gateway | แผนการส่งคำตอบ v2 และขอบเขต rollout | รายการ ID คั่นด้วยจุลภาค (ว่าง = ไม่จำกัด) | ไม่บังคับ |
| `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED` | api, ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_DOCUMENT_QA_ENABLED` | api, ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_APPROVED_KNOWLEDGE_ENABLED` | api, ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_PUBLIC_LOOKUP_ENABLED` | api, ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_PREFERENCES_ENABLED` | api, ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_BUFFER_DEBOUNCE_MS` | api | การรวมข้อความ LINE ก่อนส่งเข้า AI (debounce/รอสูงสุด) | ตัวเลข; เริ่มต้น `2000` | ไม่บังคับ |
| `LINE_AI_BUFFER_MAX_WAIT_MS` | api | การรวมข้อความ LINE ก่อนส่งเข้า AI (debounce/รอสูงสุด) | ตัวเลข; เริ่มต้น `8000` | ไม่บังคับ |
| `LINE_AI_LOADING_ANIMATION_ENABLED` | api | แสดง animation กำลังโหลดใน LINE | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_LOADING_ON_ACCEPT_ENABLED` | api | แสดง animation กำลังโหลดใน LINE | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED` | api | การทดลอง debounce (ปิดใน production) | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_DEBOUNCE_EXPERIMENT_SECRET` | api | การทดลอง debounce (ปิดใน production) | ข้อความ — **secret** | ไม่บังคับ |
| `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` | api, ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` | api, ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE` | api | โหมด rollout ของความสามารถ LINE AI | off \| shadow \| primary; เริ่มต้น `off` | ไม่บังคับ |
| `LINE_AI_REIMBURSEMENT_SEMANTIC_MODE` | api | โหมด rollout ของความสามารถ LINE AI | off \| shadow \| clarify_only \| handoff; เริ่มต้น `off` | ไม่บังคับ |
| `LINE_AI_INTAKE_STATE_MODE` | api | โหมด rollout ของความสามารถ LINE AI | off \| shadow \| on; เริ่มต้น `off` | ไม่บังคับ |
| `LINE_AI_ADVISOR_MODE` | api | โหมด rollout ของความสามารถ LINE AI | off \| social \| knowledge \| company; เริ่มต้น `off` | ไม่บังคับ |
| `LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED` | api | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` | api | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_FLEX_TEXT_FALLBACK_ENABLED` | api | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED` | api | บทสนทนาร่างรายจ่ายใน LINE | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_DRAFT_EDIT_ENABLED` | api, ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_LEDGER_ENABLED` | api | LINE turn ledger บน Redis Streams (ADR 0010) | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_LEDGER_MAXLEN` | api | LINE turn ledger บน Redis Streams (ADR 0010) | ตัวเลข; เริ่มต้น `200` | ไม่บังคับ |
| `LINE_AI_LEDGER_TTL_SECONDS` | api | LINE turn ledger บน Redis Streams (ADR 0010) | ตัวเลข; เริ่มต้น `86400` | ไม่บังคับ |
| `LINE_AI_LEDGER_CLAIM_MIN_IDLE_MS` | api | LINE turn ledger บน Redis Streams (ADR 0010) | ตัวเลข; เริ่มต้น `120000` | ไม่บังคับ |
| `LINE_AI_LEDGER_DELIVERY_CAP` | api | LINE turn ledger บน Redis Streams (ADR 0010) | ตัวเลข; เริ่มต้น `3` | ไม่บังคับ |
| `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED` | api | รับเอกสารจากกลุ่ม LINE | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `EXPENSE_CAPTURE_PDF_MAX_PAGES` | api | จำนวนหน้า PDF สูงสุด | ตัวเลข; เริ่มต้น `60` | ไม่บังคับ |
| `EXPENSE_CAPTURE_READ_CONCURRENCY` | api | จำนวนงานอ่านพร้อมกัน | ตัวเลข; เริ่มต้น `2` | ไม่บังคับ |
| `EXPENSE_CAPTURE_RETENTION_DAYS` | api | อายุข้อมูล capture | ตัวเลข; เริ่มต้น `90` | ไม่บังคับ |
| `EXPENSE_CAPTURE_DERIVATIVE_MAX_BYTES` | api | ขนาดไฟล์แปลงสูงสุด | ตัวเลข; เริ่มต้น `67_108_864` | ไม่บังคับ |
| `LINE_AI_AGENT_ORCHESTRATION_ENABLED` | ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_AGENT_RUNTIME` | ai-gateway | การตั้งค่า LINE AI | strands-local \| disabled \| agentcore; เริ่มต้น `disabled` | ไม่บังคับ |
| `LINE_AI_TOOLUSE_LOOP_ENABLED` | ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_COVERAGE_CRITIC_ENABLED` | ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |
| `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` | ai-gateway | การตั้งค่า LINE AI | รายการ `tool::รูปแบบ` คั่นด้วยจุลภาค; เริ่มต้น 10 ตระกูลในโค้ด | ไม่บังคับ |
| `LINE_AI_PROVIDER_CLIENT_REUSE_ENABLED` | ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_AGENTCORE_SESSION_AFFINITY_ENABLED` | ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_SMALL_ROUTER_SHADOW_ENABLED` | ai-gateway | สวิตช์ความสามารถของ LINE AI | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `LINE_AI_LEDGER_RECLAIM_INTERVAL_MS` | workers | รอบ reclaim ของ LINE ledger | ตัวเลข; เริ่มต้น `60000` | ไม่บังคับ |

#### 3.2.7 AI provider, นโยบายโมเดล, งบ AI, AgentCore (42 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `AI_DATA_RETENTION_DAYS` | api | อายุข้อมูล AI | ตัวเลข; เริ่มต้น `90` | ไม่บังคับ |
| `AI_FINAL_MUTATION_ENABLED` | api, ai-gateway | ให้ AI เขียนข้อมูลขั้นสุดท้ายเอง | boolean (`true`/`false`); เริ่มต้น `false` | production ต้อง `false` (ต้องมี ADR ก่อนเปิด) |
| `AI_LLM_MAX_PER_COMPANY` | api | เพดานการเรียก LLM ต่อบริษัทต่อหน้าต่าง | ตัวเลข; เริ่มต้น `60` | ไม่บังคับ |
| `AI_OCR_MAX_PER_COMPANY` | api | เพดานการอ่านเอกสารต่อบริษัทต่อหน้าต่าง | ตัวเลข; เริ่มต้น `20` | ไม่บังคับ |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | api | หน้าต่าง rate limit ของ AI | ตัวเลข; เริ่มต้น `60` | ไม่บังคับ |
| `AI_THB_PER_USD` | api | อัตราแลกเปลี่ยนสำรองสำหรับคิดต้นทุน AI | ตัวเลข; เริ่มต้น `33` | ไม่บังคับ |
| `AI_MONTHLY_BUDGET_SATANG` | api | งบ AI รายเดือนต่อบริษัท (สตางค์) | ตัวเลข; เริ่มต้น `200000` | ไม่บังคับ |
| `AI_MONTHLY_BUDGET_SATANG_CEILING` | api | เพดานที่ผู้ดูแลปรับงบรายบริษัทได้ | ตัวเลข; เริ่มต้น `1000000` | production ต้อง ≥ `AI_MONTHLY_BUDGET_SATANG` |
| `APPROVED_AI_MODEL_IDS` | api, ai-gateway | allowlist ของ model | ข้อความ; เริ่มต้นคือ `DEFAULT_APPROVED_AI_MODEL_IDS` ในโค้ด | ไม่บังคับ |
| `APPROVED_AI_PROVIDERS` | api, ai-gateway | allowlist ของ provider | ข้อความ; เริ่มต้น `bedrock,openai` | ไม่บังคับ |
| `APPROVED_AI_REGIONS` | api, ai-gateway | allowlist ของ region | boolean (`true`/`false`); เริ่มต้น `ap-southeast-1` | ไม่บังคับ |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVED` | api, ai-gateway | อนุมัติ global inference profile ของ Bedrock (ข้ามพรมแดน) | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` | api, ai-gateway | เลขอ้างอิงการอนุมัติด้านคุ้มครองข้อมูล | ข้อความ | จำเป็นเมื่อ `AI_GLOBAL_INFERENCE_PROFILE_APPROVED=true` |
| `ANTHROPIC_API_KEY` | ai-gateway | เรียก Anthropic API ตรงสำหรับ eval ในเครื่อง | ข้อความ — **secret** | local เท่านั้น — schema ปฏิเสธเมื่อ `APP_ENV` ไม่ใช่ `local` |
| `MODEL_PROVIDER` | ai-gateway | ผู้ให้บริการโมเดล | disabled \| bedrock \| openai; เริ่มต้น `disabled` | ไม่บังคับ |
| `OPENAI_API_KEY` | ai-gateway | API key ของ OpenAI | ข้อความ — **secret** | จำเป็นเมื่อ `MODEL_PROVIDER=openai` |
| `OPENAI_MODEL` | ai-gateway | model ของ OpenAI | ข้อความ; เริ่มต้น `gpt-4.1-mini` | ไม่บังคับ |
| `OPENAI_PROCESSING_REGION` | ai-gateway | region ประมวลผลของ OpenAI | ข้อความ | จำเป็นเมื่อ `MODEL_PROVIDER=openai` |
| `BEDROCK_REGION` | ai-gateway | region ของ Bedrock | ข้อความ | จำเป็นเมื่อ `MODEL_PROVIDER=bedrock` |
| `BEDROCK_MODEL_ID` | ai-gateway | model/inference profile ของ Bedrock | ข้อความ | จำเป็นเมื่อ `MODEL_PROVIDER=bedrock`; ต้องอยู่ใน allowlist |
| `DOCUMENT_AI_MODEL_ID` | ai-gateway | model สำหรับอ่านเอกสาร | ข้อความ | ไม่บังคับ |
| `AI_GATEWAY_ENABLED` | ai-gateway | เปิด gateway | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `AI_AGENT_REGISTRY_ENABLED` | ai-gateway | เปิด agent registry | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `AI_TOOL_POLICY_ENFORCED` | ai-gateway | บังคับ policy ของเครื่องมือ | boolean (`true`/`false`); เริ่มต้น `true` | ต้อง `true` เมื่อเปิดเครื่องมือ AI |
| `AI_TOOL_AUDIT_ENABLED` | ai-gateway | audit การเรียกเครื่องมือ | boolean (`true`/`false`); เริ่มต้น `true` | ต้อง `true` เมื่อเปิดเครื่องมือ AI |
| `AI_PROMPT_LOGGING_ENABLED` | ai-gateway | log prompt | boolean (`true`/`false`); เริ่มต้น `false` | production ต้อง `false` |
| `AI_MAX_TOOL_CALLS` | ai-gateway | จำนวน tool call สูงสุดต่อ turn (≤ 8) | ตัวเลข; เริ่มต้น `8` | ไม่บังคับ |
| `AI_TOOL_TIMEOUT_MS` | ai-gateway | timeout ของ tool | ตัวเลข; เริ่มต้น `10000` | ไม่บังคับ |
| `AWS_PROFILE` | ai-gateway | profile ของ AWS ใน local | ข้อความ | ไม่บังคับ |
| `AWS_SDK_LOAD_CONFIG` | ai-gateway | ให้ SDK อ่าน config file | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `AGENTCORE_REGION` | ai-gateway | region ของ AgentCore | ข้อความ | จำเป็นเมื่อ runtime เป็น `agentcore` |
| `AGENTCORE_RUNTIME_ARN` | ai-gateway | ARN ของ runtime | ข้อความ | จำเป็นเมื่อ runtime เป็น `agentcore` |
| `AGENTCORE_RUNTIME_QUALIFIER` | ai-gateway | endpoint ที่เรียก | ข้อความ | จำเป็นเมื่อ runtime เป็น `agentcore` |
| `AGENTCORE_EXPECTED_SOURCE_COMMIT` | ai-gateway | commit ที่ runtime ต้องรายงาน | commit SHA 40 ตัวอักษร | จำเป็นเมื่อ runtime เป็น `agentcore` |
| `AGENTCORE_EXPECTED_ARTIFACT_SHA256` | ai-gateway | hash ของ artifact ที่ต้องตรง | hex 64 ตัวอักษร | จำเป็นเมื่อ runtime เป็น `agentcore` |
| `AGENTCORE_EXPECTED_CONTRACT_VERSION` | ai-gateway | เวอร์ชัน contract | ตัวเลข | จำเป็นเมื่อ runtime เป็น `agentcore` |
| `AGENTCORE_INVOKE_TIMEOUT_MS` | ai-gateway | timeout การเรียก | ตัวเลข; เริ่มต้น `20000` | ไม่บังคับ |
| `AGENTCORE_MAX_BODY_BYTES` | ai-gateway | ขนาด body สูงสุด | ตัวเลข; เริ่มต้น `1048576` | ไม่บังคับ |
| `AGENTCORE_MAX_MESSAGE_CHARS` | ai-gateway | ความยาวข้อความสูงสุด | ตัวเลข; เริ่มต้น `8000` | ไม่บังคับ |
| `AGENTCORE_MAX_ATTACHMENTS` | ai-gateway | จำนวนไฟล์แนบสูงสุด | ตัวเลข; เริ่มต้น `10` | ไม่บังคับ |
| `AGENTCORE_MAX_CONCURRENT_INVOCATIONS` | ai-gateway | การเรียกพร้อมกันสูงสุด | ตัวเลข; เริ่มต้น `16` | ไม่บังคับ |
| `AI_GATEWAY_SHUTDOWN_DRAIN_MS` | ai-gateway | เวลารอ drain ตอนปิด | ตัวเลข; เริ่มต้น `20_000` | ไม่บังคับ |

#### 3.2.8 อีเมลและ billing (15 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `EMAIL_PROVIDER` | api | ผู้ส่งอีเมล | disabled \| local-console \| ses \| postmark; เริ่มต้น `disabled` | production ห้าม `local-console` |
| `BILLING_MODE` | api | โหมด billing | disabled \| test \| live; เริ่มต้น `disabled` | ไม่บังคับ |
| `STRIPE_ACCOUNT_ID` | api | บัญชี Stripe ที่คาดหวัง (ไม่ใช่ secret) | `acct_…` | ไม่บังคับ |
| `STRIPE_SECRET_KEY` | api | API key ของ Stripe | ข้อความ — **secret** | ไม่บังคับ |
| `STRIPE_WEBHOOK_SECRET` | api | secret ตรวจ webhook ของ Stripe | ข้อความ — **secret** | ไม่บังคับ |
| `POSTMARK_SERVER_TOKEN` | api | token ของ Postmark server | ข้อความ — **secret** | ไม่บังคับ |
| `POSTMARK_SERVER_ID` | api | id ของ Postmark server | ตัวเลข | ไม่บังคับ |
| `POSTMARK_MESSAGE_STREAM` | api | message stream | ข้อความ; เริ่มต้น `outbound` | ไม่บังคับ |
| `POSTMARK_FROM_ADDRESS` | api | ที่อยู่ผู้ส่ง | อีเมล | ไม่บังคับ |
| `POSTMARK_FROM_NAME` | api | ชื่อผู้ส่ง | ข้อความ; เริ่มต้น `Mangmee Plus` | ไม่บังคับ |
| `POSTMARK_UAT_ALLOWED_RECIPIENTS` | api | ผู้รับที่ UAT ส่งได้ | ข้อความ; เริ่มต้นว่าง | ไม่บังคับ |
| `POSTMARK_WEBHOOK_USERNAME` | api | basic auth ของ webhook Postmark | ข้อความ | ไม่บังคับ |
| `POSTMARK_WEBHOOK_PASSWORD` | api | basic auth ของ webhook Postmark | ข้อความ — **secret** | ไม่บังคับ |
| `SES_REGION` | api | region ของ SES | ข้อความ | จำเป็นเมื่อ `EMAIL_PROVIDER=ses` |
| `SES_FROM_ADDRESS` | api | ผู้ส่งของ SES | อีเมล | จำเป็นเมื่อ `EMAIL_PROVIDER=ses` |

#### 3.2.9 CRM และ workflow (4 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `CRM_AUTO_REPLY_ENABLED` | api | สวิตช์รวมของ auto-reply ใน CRM | boolean (`true`/`false`); เริ่มต้น `false` | ไม่บังคับ |
| `CRM_AI_MIN_CONFIDENCE` | api | ความมั่นใจขั้นต่ำของ AI ใน CRM | ตัวเลข; เริ่มต้น `0.7` | ไม่บังคับ |
| `CRM_AI_OUTBOUND_ALLOWED_DOMAINS` | api | โดเมนที่ AI ของ CRM ส่งลิงก์ได้ | ข้อความ; เริ่มต้นว่าง | ไม่บังคับ |
| `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` | api | host ปลายทางของ webhook ขาออก | ข้อความ; เริ่มต้นว่าง | จำเป็นใน production (ใส่ `none` เพื่อปฏิเสธทั้งหมด) |

#### 3.2.10 Web (3 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | web | URL ของ API ที่ฝังใน bundle | URL | จำเป็น (web, ตอน build) |
| `NEXT_PUBLIC_AI_GATEWAY_BASE_URL` | web | URL ของ gateway ที่ฝังใน bundle | URL | จำเป็น (web, ตอน build) |
| `NEXT_PUBLIC_APP_ENV` | web | ป้าย environment ฝั่ง client | local \| production | ไม่บังคับ |

#### 3.2.11 Workers (6 ตัว)

| ชื่อ | แอป | หน้าที่ | รูปแบบ / ค่าเริ่มต้น | เงื่อนไข |
|---|---|---|---|---|
| `QUEUE_ENABLED` | workers | เปิด consumer ของ queue | boolean (`true`/`false`); เริ่มต้น `true` | ต้อง `true` เมื่อ serving mode เป็น `live` และ `false` เมื่อ `maintenance_only` |
| `QUEUE_CONCURRENCY` | workers | concurrency ของ worker | ตัวเลข; เริ่มต้น `5` | ไม่บังคับ |
| `QUEUE_RETRY_ATTEMPTS` | workers | จำนวน retry | ตัวเลข; เริ่มต้น `3` | ไม่บังคับ |
| `QUEUE_RETRY_BACKOFF_MS` | workers | backoff | ตัวเลข; เริ่มต้น `1000` | ไม่บังคับ |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | workers | เวลารอปิด | ตัวเลข; เริ่มต้น `15000` | ไม่บังคับ |
| `DLQ_ENABLED` | workers | เปิด dead-letter queue | boolean (`true`/`false`); เริ่มต้น `true` | ไม่บังคับ |

### 3.3 ตัวแปรที่โค้ด runtime อ่านตรงจาก `process.env` นอก schema

| ชื่อ | แอป | หน้าที่ | อ่านที่ |
|---|---|---|---|
| `EXPENSE_DRAFT_NUMBERING_ENABLED` | api | เปิดเลขเอกสารของร่างรายจ่าย (ตั้ง `true` ทั้ง UAT และ production ใน `infra/kamal/config.json`) | `apps/api/src/modules/expenses/infrastructure/expense-number.ts` |
| `BILLING_RATE_LIMIT_WINDOW_SECONDS` | api | หน้าต่าง rate limit ของ billing (ใช้ย่อเวลาใน smoke) | `apps/api/src/modules/billing/billing-rate-limit-window.ts` |
| `CRM_BROADCAST_ENABLED` | api | สวิตช์ฟีเจอร์ broadcast ของ CRM ที่เลื่อนไว้ | `apps/api/src/modules/crm-inbox/domain/logic/crm-deferred-feature.logic.ts` |
| `EMAIL_LOGO_URL` | api | URL โลโก้ในอีเมล claim บัญชี | `apps/api/src/modules/auth/infrastructure/account-claim-email.template.ts` |
| `SES_CONFIGURATION_SET` | api | configuration set ของ SES | `apps/api/src/modules/auth/infrastructure/ses-auth-mailer.adapter.ts` |
| `SES_EVENTS_TOPIC_ARN` | api | SNS topic ของ event จาก SES | `apps/api/src/modules/external-signup/application/ses-event.use-case.ts` |
| `AI_DRAFT_PROVIDER`, `AI_GATEWAY_URL` | api | เลือก provider ของ AI draft และ URL ของ gateway | `apps/api/src/modules/ai-draft/infrastructure/provider/llm-draft-provider.factory.ts` |
| `HOSTNAME` | api | ระบุ instance ของตัวอ่านเอกสาร | `apps/api/src/modules/expenses/application/services/expense-capture-read-runner…` |
| `CI` | api | ใช้ใน guard ของ spec PostgreSQL | `apps/api/src/common/database/pg-spec-guard.ts` |
| `AGENTCORE_ARTIFACT_SHA256`, `AWS_REGION` | ai-gateway (AgentCore runtime) | hash ของ artifact ที่ runtime รายงาน, region | `apps/ai-gateway/src/agentcore/runtime.ts` |
| `PROVIDER_SMOKE_OUTPUT_SCHEMA` | ai-gateway | ตัวเลือกของ provider smoke | `…/infrastructure/provider/provider-smoke.ts` |
| `AUTH_COOKIE_SECURE` | web | บังคับ cookie แบบ secure | `apps/web/src/common/auth/auth-cookies.server.ts` |
| `INTERNAL_API_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_DIST_DIR` | web | URL ของ API ฝั่ง server (rewrite `/api/v1/*`), ชื่อสำรองของ URL สาธารณะ, โฟลเดอร์ build ของ Next | `apps/web/next.config.mjs` |
| `NEXT_PUBLIC_LINE_OA_URL` | web (build arg) | ลิงก์เพิ่มเพื่อน OA | `apps/web/Dockerfile` |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `APP_ENV`, `DEPLOY_ENVIRONMENT`, `NODE_ENV` | web | ใช้สร้าง CSP และพฤติกรรมตาม environment | `apps/web` |
| `WEB_BASE_URL` | workers | สร้างลิงก์ในงานแจ้งเตือน | `apps/workers/src` |
| `API_PORT`, `WEB_PORT`, `GLOBAL_MAINTENANCE_MODE` | api-web proxy | port ภายในของ API/web และโหมดปิดปรับปรุงทั้งระบบ | `infra/api-web/web-api-proxy.mjs` |
| `CLAMAV_PORT` | api-web runtime | port ของ clamd ที่ script เริ่มระบบรอ | `infra/api-web/start-api-web-runtime.sh` |
| `KAMAL_RETIRE_PROOF` | tools | หลักฐานสำหรับ retire build | `infra/kamal/retire-builds.cjs` |

ตัวแปรใน `.env.example` ที่ **ไม่พบการอ่านในโค้ดแอป** (ใช้ใน compose หรือสคริปต์ยุค ECS เท่านั้น): `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, `AI_GATEWAY_PORT` (port ของ compose); `PUBLIC_DOMAIN_URL`, `LINE_OA_ADD_URL`, `LINE_OA_QR_IMAGE_URL`, `LINE_ACCOUNT_LINK_URL`, `LINE_ACCOUNT_LINK_QR_IMAGE_URL` (`infra/prod-ecs-express/deploy.sh`, compose)

### 3.4 ตัวแปรของสคริปต์ปฏิบัติการ การทดสอบ และ eval (ไม่ใช่ runtime)

| กลุ่ม | ชื่อ | ใช้โดย |
|---|---|---|
| Seed / ผู้ดูแล | `SEED_OWNER_PASSWORD`, `SEED_COMPANY_VIEW_PASSWORD`, `SEED_SYSTEM_ADMIN_USERNAME`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`, `ADMIN_MUST_CHANGE_PASSWORD` | `apps/api/prisma/seed.ts`, `add-system-admin.ts`, `reset-system-admin-password.ts` |
| System admin cutover | `SYSTEM_ADMIN_CUTOVER_MODE`, `SYSTEM_ADMIN_CUTOVER_API_BASE_URL` | `apps/api/prisma/system-admin-cutover.ts` |
| Migration catalog | `ALLOW_PENDING_MIGRATIONS`, `REQUIRE_NO_AWS_CREDENTIALS` | `apps/api/prisma/verify-applied-migration-catalog.ts` |
| Release operation (ยุค ECS) | `RELEASE_OPERATION_ID`, `RELEASE_OPERATION_MODE`, `RELEASE_OPERATION_DEPLOYMENT_ARN`, `RELEASE_PARENT_OPERATION_ID`, `RELEASE_RECONCILE_OPERATION_ID`, `RELEASE_RECOVERY_BUILD_RELEASE_ID`, `RELEASE_RECOVERY_EXECUTOR_IMAGE`, `RELEASE_RECOVERY_PARENT_TASK_EVIDENCE_JSON`, `RELEASE_RECOVERY_VALIDATED_CI_RUN_ID`, `RELEASE_BOOTSTRAP_CLOSED_RECOVERY_JSON`, `ECS_CONTAINER_METADATA_URI_V4`, `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, `AWS_REGION`, `RELEASE_TASKS_APPLIED_SHA`, `PRODUCTION_IMAGE_MANIFEST` | `apps/api/prisma/run-exclusive-release-operation.ts`, `infra/prod-ecs-express/deploy.sh` |
| F2 normalize | `F2_APPLY`, `F2_VERIFY`, `F2_ALLOW_EXCEPTIONS`, `F2_ARTIFACT_PATH` | `apps/api/prisma/normalize-entitlements.ts` |
| A5 / U5 evidence | `A5_READONLY_DATABASE_URL`, `A5_ARTIFACT_PATH`, `A5_SCHEMA_PROFILE`, `A5_TARGET_ENVIRONMENT`, `DEPLOY_ENV`, `PRODUCTION_A5_CLONE_DATABASE_URL`, `PRODUCTION_A5_INPUT_BUNDLE_B64`, `PRODUCTION_A5_*_PATH` (7 ตัว: `PAYLOAD`, `POST_MIGRATION_PAYLOAD`, `POST_MIGRATION_REF`, `PRE_PAYLOAD`, `PRE_REF`, `REIMBURSEMENT_QUIESCE`, `SERVING_BUILDS`), `U5_CAPACITY_APPROVAL_REF`, `U5_CAPACITY_BASELINE_HASH`, `U5_CAPACITY_MARKER` | `apps/api/prisma/a5-*.ts`, `production-a5/*`, `apps/api/src/scripts/a5-*` |
| CRM setup | `MVP10_COMPANY_ID` | `apps/api/prisma/crm-mvp1-0-setup.ts` |
| Reconcile | `REIMBURSEMENT_RECONCILE_LIMIT` | `apps/api/src/scripts/reconcile-reimbursement-projections.ts` |
| Billing smoke | `BILLING_TEST_DATABASE_URL`, `BILLING_BROWSER_E2E`, `BILLING_BROWSER_EVIDENCE_DIR`, `BILLING_SLA_SLOW_BROWSER`, `BILLING_PROVIDER_EVENTS_FORCE_RATE_LIMIT`, `BILLING_SETTLEMENT_FORCE_RATE_LIMIT`, `MANGMEE_MARKETING_DIR` และตัวเลือกชุดย่อย `BILLING_<ชื่อ>_ONLY` 45 ตัว (`ADJUSTMENTS`, `APPLY_RETRY`, `BATCHES`, `CHECKOUT_EXPIRY`, `CLAIM_HISTORY`, `CONFIG`, `CUSTOMER_JOURNEYS`, `EMAIL_ACCESS`, `EMAIL_MONITORING`, `EMAIL_RESET`, `EMAIL_VERIFICATION`, `FEATURE_CONTROLS`, `INVOICE_IMPORT`, `INVOICE_SCANS`, `LINE_BINDING`, `LINE_CREDENTIALS`, `MANUAL_PLAN`, `NOTIFICATIONS`, `NO_SETUP`, `OFFER_MATRIX`, `OFFER_TERMS`, `PACKAGE_REQUEST`, `PLAN_ADJUSTMENTS`, `PLAN_CHANGE`, `PROFILE`, `PROVIDER_EVENTS`, `PROVIDER_SCANS`, `PURCHASE_RECOVERY`, `READINESS`, `RECEIPT_ADJUSTMENTS`, `RECEIPT_QUOTA`, `REFUNDS`, `REFUND_CONTROLS`, `REPEAT_APPLY`, `RESTART`, `SALES_COHORT`, `SCAN_SCHEDULE`, `SCHEDULED_POLICY`, `SCOPES`, `SETTLEMENT`, `SIGNUP_JOURNEY`, `SUPPORT_OUTCOMES`, `SUPPORT_SLA`, `TRIAL_CARRYOVER`, `UPGRADE`) | `apps/api/src/scripts/billing-*.ts` |
| LINE smoke | `API_URL`, `LINE_LOCAL_USER_ID`, `SMOKE_SCENARIO` | `apps/api/src/modules/line-ai/line-webhook-local-smoke.ts` |
| E2E | `E2E_API_BASE_URL`, `E2E_WEB_BASE_URL`, `E2E_COMPANY_ID`, `API_PORT`, `WEB_PORT`, `API_DIST_DIR`, `S3_E2E`, `S3_E2E_ACTIVE`, `EVIDENCE_DIR`, `MANGMEE_WEB_ROOT`, `MARKETING_EVIDENCE_DIR`, `MARKETING_FAILURE_PROOF` | `playwright.config.ts`, `e2e/harness/*`, `e2e/stripe-marketing-readiness.mjs` |
| AI eval | `MANGMEE_EVAL_SECRETS_PATH`, `MANGMEE_EVAL_ANTHROPIC_KEY_FILE`, `MANGMEE_EVAL_REDIS_URL`, `MANGMEE_EVAL_API_PORT`, `MANGMEE_EVAL_GATEWAY_PORT`, `MANGMEE_EVAL_CORPUS`, `MANGMEE_EVAL_EVIDENCE`, `MANGMEE_EVAL_OUTPUT_DIR`, `MANGMEE_EVAL_MAX_THB`, `MANGMEE_EVAL_SPEND_PATH`, `MANGMEE_EVAL_SKIP_BUILD`, `MANGMEE_EVAL_LOG_LEVEL`, `MANGMEE_EVAL_DEBOUNCE_MS`, `MANGMEE_EVAL_TURN_PAUSE_MS`, `MANGMEE_EVAL_CONVERSATION_PAUSE_MS`, `MANGMEE_EVAL_DETERMINISTIC_RESPONSE_FAMILIES`, `LINE_AI_EVAL_CONCURRENCY`, `LINE_AI_EVAL_LIMIT`, `LINE_AI_EVAL_REPEATS`, `LINE_AI_CONTROLLED_CADENCE_MS`, `AI_GATEWAY_URL`, `AI_BUDGET_RESERVATION_TEST_DATABASE_URL`, `LINE_RELIABILITY_TEST_REDIS_URL`, `LINE_RELIABILITY_TEST_RESULT_PATH` | `scripts/line-ai-expense-advisor/*`, `scripts/run-line-ai-*`, `scripts/line-ai-reliability-compiled-smoke.cjs` |
| Local proof | `LOCAL_PROOF_OUTPUT_DIR`, `TRIAL_REDIS_URL`, `PROOF_REDIS_URL`, `POSTGRES_CONTAINER` และค่าใน `settings.local.sh` | `scripts/local-proof/*` |
| Post-restore | `INTERNAL_API_URL`, `WORKER_INTERNAL_TOKEN`, `RESTORED_SNAPSHOT_AT` | `infra/security/post-restore-re-erasure.sh` |
| Monitoring (ยุค ECS) | `LOG_KMS_KEY_ID`, `SECURITY_ALERT_TOPIC_ARN`, `AWS_REGION` | `infra/prod-ecs-express/deploy.sh`, `infra/monitoring/runtime-alarms.sh` |
| Official OA | `OFFICIAL_BUNDLE_PATH` | `infra/line-official/handler.spec.cjs` |

### 3.5 ชื่อ secret ใน AWS Secrets Manager (ชื่อเท่านั้น)

รูปแบบ `watchdog-bms/<environment>/<ชื่อ>`; production เคยมี secret ของ ERP 23 ตัวและ UAT 24 ตัว (นับจากบันทึกการกู้ 2026-10-09 และ baseline 2026-10-10) ชื่อที่ปรากฏใน repo:

| ชื่อ secret (แทน `<env>` ด้วย `production` หรือ `uat`) | ตัวแปรที่ผูก |
|---|---|
| `watchdog-bms/<env>/database-url` | `DATABASE_URL` |
| `watchdog-bms/<env>/redis-url` | `REDIS_URL` |
| `watchdog-bms/<env>/watchdog-jwt-secret` | `WATCHDOG_JWT_SECRET_ARN` |
| `watchdog-bms/<env>/worker-internal-token` | `WORKER_INTERNAL_TOKEN` |
| `watchdog-bms/<env>/ai-gateway-internal-secret` | `AI_GATEWAY_INTERNAL_SECRET` |
| `watchdog-bms/<env>/ai-actor-delegation-signing-key` | `AI_ACTOR_DELEGATION_SIGNING_KEY` |
| `watchdog-bms/<env>/credential-encryption-key` | `CREDENTIAL_ENCRYPTION_KEY` |
| `watchdog-bms/<env>/pdpa-pseudonymization-key`, `…/pdpa-pseudonymization-previous-keys` | `PDPA_PSEUDONYMIZATION_KEY`, `PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS` |
| `watchdog-bms/<env>/line-login-channel-secret` | `LINE_LOGIN_CHANNEL_SECRET` |
| `watchdog-bms/<env>/line-messaging-channel-secret`, `…/line-messaging-channel-access-token` | `LINE_MESSAGING_CHANNEL_SECRET`, `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` |
| `watchdog-bms/production/line-official/channel-secret`, `…/channel-access-token` | `LINE_OFFICIAL_CHANNEL_SECRET`, `LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN` |
| `watchdog-bms/<env>/stripe/STRIPE_SECRET_KEY`, `…/stripe/STRIPE_WEBHOOK_SECRET` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `watchdog-bms/<env>/postmark/POSTMARK_SERVER_TOKEN`, `…/POSTMARK_WEBHOOK_USERNAME`, `…/POSTMARK_WEBHOOK_PASSWORD`, `…/EMAIL_OTP_HMAC_KEY` | ชื่อเดียวกับตัวแปร (`infra/postmark/config.json`) |
| `watchdog-bms/uat/postmark/POSTMARK_UAT_ALLOWED_RECIPIENTS` | `POSTMARK_UAT_ALLOWED_RECIPIENTS` |
| `watchdog-bms/production/typhoon-ocr-api-key` | (ยุค ECS; ดูหมายเหตุหัวข้อ 3.3) |
| `watchdog-bms/production/s3-bucket`, `…/service-version`, `…/erp-core-internal-url`, `…/ai-gateway-internal-url`, `…/ai-gateway-public-base-url` | ค่าคอนฟิกที่เก็บเป็น parameter/secret ในยุค ECS |
| `watchdog-bms/<env>/ecs-express-{api-web,ai-gateway,workers}-{url,service-arn}` | ตัวชี้ของ ECS Express (ล้าสมัย) |
| `watchdog-bms/production/a5-readonly-database-url`, `…/a5-readonly-runtime/…`, `…/a5-network/…`, `…/a5-clone/…`, `watchdog-bms/uat/evidence/u5-capacity-v2`, `watchdog-bms/uat/redis-migration-lock` | ceremony A5/U5 และ mutex (ล้าสมัย) |
| `watchdog-bms/production/support-rw-armed` | สถานะการ arm บทบาทเขียนของ support (หัวข้อ 4.4) |
| `watchdog-bms/production/system-admin-cutover-password` | รหัสชั่วคราวของ cutover ผู้ดูแล (ใช้ครั้งเดียว ถูกยกเลิกแล้ว) |

ค่าที่ track ใน `infra/kamal/config.json` (ไม่ใช่ secret): production `api-web` — `EXPENSE_DRAFT_NUMBERING_ENABLED`, `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED`, `BILLING_MODE`, `STRIPE_ACCOUNT_ID`, `LINE_OFFICIAL_REPLY_ENABLED`, `LINE_AI_BUFFER_DEBOUNCE_MS`; production/UAT `ai-gateway` — `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES`; UAT `api-web` — `EXPENSE_DRAFT_NUMBERING_ENABLED`, `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED`, `LINE_AI_BUFFER_DEBOUNCE_MS` ค่าอีเมลที่ไม่ใช่ secret ต่อ environment อยู่ใน `infra/postmark/config.json` (`POSTMARK_FROM_ADDRESS`, `POSTMARK_FROM_NAME`, `POSTMARK_MESSAGE_STREAM`, `POSTMARK_SERVER_ID`, `EMAIL_OTP_HMAC_KEY_VERSION`)

ข้อสังเกตเชิงปฏิบัติการ: AgentCore runtime เก็บสำเนา environment ของตัวเองตอน release (รวม `APPROVED_AI_MODEL_IDS` และการอนุมัติ global profile ตั้งแต่ 2026-11-09) การแก้ค่าใน gateway อย่างเดียวจึงไม่ถึง runtime จนกว่าจะ release ใหม่

---

## 4. การปฏิบัติการฐานข้อมูล

ฐานข้อมูลเดียวคือ PostgreSQL ผ่าน Prisma 7 (driver adapter `@prisma/adapter-pg`); schema ที่ `apps/api/prisma/schema.prisma`; migration 313 ชุดใน `apps/api/prisma/migrations/` ตั้งแต่ `20260624000000_init` ถึง `20261109130000_line_webhook_message_id` สำเนาสำรองสุดท้ายมี 283 ตาราง (หัวข้อ 9)

### 4.1 ขั้นตอน migration

| สถานการณ์ | ขั้นตอน |
|---|---|
| Local | `pnpm --filter @watchdog-bms/api exec prisma migrate status` → `prisma migrate deploy` → `prisma generate` → (ถ้าต้องการข้อมูล) `tsx prisma/seed.ts` — `migrate deploy` ไม่แตะข้อมูลเดิม |
| เขียน migration ใหม่ | แก้ `schema.prisma`, สร้างโฟลเดอร์ migration ที่ตั้งชื่อด้วย timestamp, ตรวจ `pnpm --filter @watchdog-bms/api prisma:validate` และ `migration:review` (พิมพ์ SQL จากศูนย์ถึง schema), รัน spec `*.pg.spec.ts` ที่เกี่ยว; ต้อง additive เพราะไม่มี down-migration |
| Release ปกติ (Kamal `--mode normal`) | tools image พก catalog ของ migration/sync ครบชุด; ตัวควบคุมรันการตรวจความปลอดภัยของ migration ที่ค้าง แล้ว apply, ตรวจ catalog ที่ apply แล้ว (`prisma/verify-applied-migration-catalog.ts`), sync ข้อมูลอ้างอิง (`sync-permissions.ts`, `sync-thai-address-master.ts`, `sync-workflow-templates.ts`, `sync-feature-launch-gates.ts`), ยืนยัน build authority (`attest-feature-launch-build.ts`, `verify-feature-launch-build-authority.ts`) และ retire build เก่า (`retire-launch-builds.ts`) |
| Hotfix | ปฏิเสธถ้ามี migration ที่ยังไม่ apply; รันเฉพาะการตรวจ catalog/sync/authority |
| ซ้อมก่อน production | `python3 infra/kamal/rehearse-database.py --manifest … --baseline-ref <SHA ที่ deploy อยู่> --postgres-image postgres:18.3-alpine [--runtime-baseline … --redis-image … --tls] --output …` — ใช้ engine เดียวกับ production |
| Drift ของ checksum | ตรวจด้วย `infra/production/inspect-migration-state.sh` (อ่านอย่างเดียว); วิธีแก้ที่เคยใช้บันทึกใน `docs/runbooks/production-migration-reconciliation.md` (2026-08-08: แก้ checksum ของ `20260714120000_item11b_transaction_tax_schema` ผ่าน writer บน bastion) |
| ยุค ECS | release task (`infra/prod-ecs-express/run-release-task.sh` + `prisma/run-exclusive-release-operation.ts`) รัน migration แบบผูกขาดและบันทึก intent เพื่อกู้ |

บทเรียนที่บันทึกไว้: migration ที่เพิ่ม CHECK constraint ต้องตรงกับ contract ของ API เสมอ (เหตุ 2026-09-30: `CompanySignupRequest_discovery_source_check` ไม่รับค่า `SALES` ที่ contract ยอมรับ ทำให้สมัครผ่าน LINE ล้ม); worktree ที่ merge มาใหม่ต้อง `prisma generate` ซ้ำ; stack local ที่รันจาก image ต้อง rebuild จึงจะได้ migration ใหม่

### 4.2 Backup

| รายการ | UAT | Production |
|---|---|---|
| RDS automated backup | 1 วัน | 35 วัน, deletion protection |
| Redis snapshot | — | 35 วัน (query ที่ระดับ member cluster ไม่ใช่ replication group) |
| S3 | versioning + lifecycle (`infra/object-storage-lifecycle.json`); worker `object-version-cleanup` ลบ version เก่าตามนโยบาย | เหมือนกัน |
| Log | CloudWatch 3 วัน | 14 วัน |
| Backup offline (เครื่องเจ้าของ) | 2026-10-07 และ 2026-11-15 (หัวข้อ 9) | เหมือนกัน |

การซ้อม restore รายไตรมาสกำหนดไว้ใน `docs/runbooks/p1-production-security-operations.md` (M-17): restore ลง subnet แยก, บันทึก RTO/RPO, ตรวจความสมบูรณ์ การ restore จริงที่บันทึกไว้คือ 2026-10-09

### 4.3 Restore — ขั้นตอนและข้อค้นพบจาก 2026-10-09

1. สร้าง RDS ใหม่ด้วย engine/ขนาดเดิมและชื่อ DNS เดิม restore dump ด้วย owner/ACL เดิม ตรวจจำนวนตาราง/แถว/sequence/extension เทียบ manifest (production 268 ตาราง/355,102 แถว; UAT 268 ตาราง/120,575 แถว ณ วันนั้น)
2. RDS ปฏิเสธ `NOSUPERUSER`/`NOREPLICATION`/`NOBYPASSRLS` ที่ระบุชัดในการ restore role แม้ค่าเป็น false — ตัด clause เหล่านี้ออก ตรวจ attribute ที่ถูกป้องกัน แล้ว restore สิทธิ์ที่เหลือใน transaction เดียว; ห้ามรัน restore ที่ commit สำเร็จแล้วซ้ำ
3. Restore S3 ทุก version แล้ว **reconcile `VersionId` ในฐานข้อมูล** (attachment และ read-job อ้าง version id; bucket ใหม่ได้ id ใหม่) โดยไม่แตะคอลัมน์ธุรกิจอื่น; ตรวจว่า attachment ที่ `ACTIVE` ทุกตัวมีไฟล์
4. Bucket ที่สร้างใหม่ต้องได้ CORS ของเบราว์เซอร์และการบล็อก SSE-C เดิม นอกเหนือจาก object, versioning และ lifecycle
5. Restore Redis (RDB) ตรวจ `PING`, จำนวน key และ queue
6. Restore secret และ SSM parameter ปัจจุบัน — ห้ามคัดลอก endpoint/role ID ของ ECS/A5 ที่ล้าสมัยกลับมา
7. การอัปโหลดหนักจากเครื่องอาจทำให้ SSM handshake ล้ม — แยกการ push ไฟล์ออกจากการโอนฐานข้อมูล
8. หลัง restore จาก snapshot ที่เก่ากว่าคำขอลบข้อมูล ต้องรัน `infra/security/post-restore-re-erasure.sh` (เรียก internal API ด้วย `WORKER_INTERNAL_TOKEN` และ `RESTORED_SNAPSHOT_AT`) เพื่อลบซ้ำตามคำขอ PDPA ที่เคยทำสำเร็จ

### 4.4 การเข้าถึงฐานข้อมูล

| วิธี | คำสั่ง | ขอบเขต |
|---|---|---|
| UAT port-forward | `infra/uat/db-port-forward.sh` (เปิด `127.0.0.1:55432`; `--url` พิมพ์ URL สำหรับ psql; `--fields` สำหรับ DBeaver; `LOCAL_PORT=…`) | ผ่าน SSM; RDS ไม่เปิดสาธารณะ; ต้องมี session-manager-plugin |
| Production T1 (อ่าน) | `infra/support/connect-production.sh view <incident-ref>` | psql อ่านอย่างเดียวบน bastion ผ่าน SSM (interactive เพื่อให้มี transcript; ไม่เปิด port-forward ตามมติ D5–D8 2026-08-08) |
| Production T2 (เขียน) | คนที่สอง `connect-production.sh arm <incident-ref> [minutes]` แล้วผู้ปฏิบัติ `connect-production.sh execute <incident-ref>` | บทบาทเขียนถูก arm ชั่วคราวด้วย `infra/production/arm-support-execute.sh`; role นิยามใน `infra/production/bootstrap-support-roles.sql` |
| ยุค Kamal (หลัง bastion ถูกปลด) | SSM port 22 บน host API + `ssh -L` ด้วย deploy role ที่ผ่าน MFA; ทำ SQL ทั้งหมดใน session เดียว | วิธีที่ใช้จริงช่วงตุลาคม–พฤศจิกายน (ไม่มีสคริปต์ใน repo) |

บันได support (`docs/runbooks/production-support-access.md`): T0 log/health → T0.5 ปิดฟีเจอร์ฉุกเฉินผ่าน launch gate → T1 อ่านข้อมูล → T2 แก้ข้อมูล — ห้ามข้าม T1 ไป T2

### 4.5 การแก้ข้อมูล (data fix)

| เครื่องมือ | ใช้ทำอะไร |
|---|---|
| `scripts/heal/line-link-reset.sh` | ล้างการผูก LINE ของบัญชี LINE หนึ่งราย (สำรวจเป็นค่าเริ่มต้น ลบเมื่อใส่ `--apply`) |
| `scripts/heal/goods-receipt-void-survey.sql`, `goods-receipt-void-apply.sql` | สำรวจและ void ใบรับสินค้า |
| `apps/api/src/scripts/backfill-billing-recipients.ts`, `backfill-dashboard-entitlement.ts`, `backfill-revenue-categories.ts`, `backfill-withholding-filings.ts`, `repair-pnd2-handoffs.ts`, `reconcile-reimbursement-projections.ts` (`pnpm --filter @watchdog-bms/api reimbursement:reconcile-projections`) | backfill/ซ่อมข้อมูลเฉพาะเรื่อง |
| `apps/api/prisma/report-label-backfill.ts`, `normalize-entitlements.ts` (F2), `crm-mvp1-0-setup.ts` | backfill ป้ายรายงาน, normalize entitlement, ตั้งค่า CRM |
| `apps/api/prisma/add-system-admin.ts`, `reset-system-admin-password.ts`, `system-admin-cutover.ts` | จัดการบัญชีผู้ดูแลระบบ |
| `apps/api/src/scripts/create-catalog-prices.ts` | สร้าง Price ของ Stripe ตาม catalog |
| `apps/api/src/scripts/chart-of-accounts-audit.ts` (`pnpm … chart:audit`), `line-identity-inventory.ts`, `line-ai-reconciliation-report.ts` | รายงานตรวจสอบแบบอ่านอย่างเดียว |
| `docs/runbooks/billing-document-correction-manual.md` | แก้ชื่อ/ที่อยู่/เลขภาษีของใบแจ้งหนี้ที่จ่ายแล้วด้วยมือ |
| `docs/runbooks/uat-feature-package-provisioning.md` | เปิดแพ็กเกจฟีเจอร์ให้บริษัท UAT ที่ onboard ก่อน deny-by-default |

หลักที่ใช้: สำรวจก่อนเสมอ, ทำใน transaction เดียว, บันทึก incident reference, และ "การปฏิเสธต้องมีทางออกในแอป" — ข้อมูลที่ผู้ใช้กรอกผิดควรแก้ได้จากหน้าจอ ไม่ใช่ด้วย SQL

---

## 5. Monitoring, log, alarm, การคุมค่าใช้จ่าย และงบ AI

### 5.1 Health และ readiness

| ปลายทาง | ใช้ทำอะไร |
|---|---|
| `GET /v1/health` (API), `/v1/health` (gateway) | liveness |
| Deep readiness ที่ตัวควบคุม release เรียก | api-web + ฐานข้อมูล, ai-gateway, workers + Redis `PING` + การเรียก internal API |
| `GET /api/v1/auth/platform-access` | สถานะ gate ของลูกค้า (`OPEN`/`CLOSED`) โดยไม่ต้องมี session |
| หน้า `/login` attribute `data-platform-access` | ตรวจจากเบราว์เซอร์ |

ข้อจำกัดที่พบจริง: liveness 200 ไม่ครอบคลุมเส้นทางที่พึ่ง Redis (เหตุ 2026-09-30)

### 5.2 Log

- รูปแบบ JSON บังคับใน production; ปิดบังค่าอ่อนไหวด้วย `SENSITIVE_LOG_KEY_PATTERN`/`redactLogValue` (`packages/config/src/index.ts`); ห้ามเปิด `AI_PROMPT_LOGGING_ENABLED`
- CloudWatch retention: UAT 3 วัน, production 14 วัน, session log ของ support 14 วัน
- Docker บน host จำกัดขนาด log (`bootstrap-host.sh`); workers มี guard จำกัด log ของความล้มเหลวร้ายแรงหลังเหตุ crash-loop เดือนสิงหาคม
- กับดักการอ่าน: `filter-log-events --limit` ให้ผลลบปลอม; `storedBytes` ของ log group คือขนาดหลังบีบอัด (~1/20 ของที่ถูกคิดเงิน); `describe-services` ของ ECS Express รายงานผิด (หัวข้อ 2 ของ cloud runbook ฉบับเดิม)

### 5.3 Alarm

`infra/monitoring/runtime-alarms.sh <install|verify|retire-invalid-prod-redis> <uat|production>`:

| ชุด | Alarm |
|---|---|
| Production (9 ตัว, ตรวจกับ datapoint จริง 2026-08-15) | `IncomingBytes` ของ log group แอป 3 กลุ่ม, หน่วยความจำ Redis ราย node 2 ตัว, RDS storage/memory/connections/CPU credit; ทุกตัวส่ง SNS topic ที่ยืนยัน subscription แล้ว |
| Production หลังกู้ 2026-10-09 | 12 alarm ของ DB/Redis/log/security + metric filter ความปลอดภัย 3 ตัว + EC2 status 4 ตัว (รวม 16; 14 OK ตอนปิดงานกู้) |
| UAT | 13 alarm + metric filter 8 ตัว |
| Dashboard | `watchdog-bms-<environment>-customer-journeys` (`docs/runbooks/customer-journey-signal-triage.md`) |
| กฎแจ้งเตือนความปลอดภัย | `infra/production/security-alert-rules.md`; สคริปต์ M-01/M-14 ของ UAT (`infra/uat/m01-actor-delegation-alert.sh`, `m14-upload-alert.sh`) |

CloudTrail: trail หลายภูมิภาค 1 ตัว (ถูกลบตอนปลดระวาง — บัญชีไม่มี CloudTrail แล้ว)

### 5.4 การคุมค่าใช้จ่ายและประวัติค่าใช้จ่าย AWS

| ช่วง | ยอด (USD) | ที่มา/หมายเหตุ |
|---|---:|---|
| 1–14 ส.ค. 2026 | 387.40 (ก่อนภาษี 362.08) | CloudWatch 180.83 (log ingest ของ incident 5–7 ส.ค.), ECS 81.32, RDS 30.07, VPC 22.95, ElastiCache 18.53, ELB 8.10; Bedrock ทั้งเดือนเพียง 3.20 |
| ก.ย. 2026 (ทั้งเดือน) | 755.80 | model inference ของ Claude 154.86; โครงสร้างพื้นฐาน 600.94 (production 323.08, UAT 125.05, shared 100.09, dev 4.54, ไม่มี tag 48.18); run rate 7 วันสุดท้ายคิดเป็น ~620.74/เดือนสำหรับส่วนที่ไม่ใช่โมเดล |
| 1–15 พ.ย. 2026 | 356.91 | ยอดสะสมก่อนปลดระวาง; ยังไม่มีข้อมูลวันหลังปิด |

ไม่พบยอดรวมของเดือนตุลาคม 2026 ในเอกสารของ repo

| มาตรการ | รายละเอียด |
|---|---|
| AWS Budget | `WatchDog-BMS Monthly Cost Budget` วงเงิน 100 USD แจ้งอีเมลที่ actual 85%/100% และ forecast 100% (ยอดจริงเกินวงเงินทุกเดือนที่บันทึก — baseline ไม่เคยถูกปรับ) |
| Cost Anomaly Detection | monitor ระดับ SERVICE 1 ตัว + subscription รายวัน; threshold ≥ 100 USD **และ** ≥ 40% |
| Cost allocation tag | `Environment` (Active), `Component`, `ManagedBy` บน resource 49 ตัว (2026-08-15) |
| ลบของที่ไม่ใช้ | NAT gateway ที่ไม่มี traffic (~43.90 USD/เดือน) และ Redis production เดิม ลบ 2026-08-07 |
| UAT Plan A (2026-10-10) | หยุด EC2 และ RDS ของ UAT เมื่อไม่ใช้ (เป้า 20 ชั่วโมง/เดือน), ALB เหลือ 2 AZ; ประหยัดตามการคาดการณ์ ~20.90 USD/เดือน; stack `mangmee-uat-power` ตรวจทุก 30 นาทีและหยุด RDS ซ้ำ (RDS เปิดเองหลังหยุด 7 วัน) |
| การล้าง disk ของ host | image เก่าของ tools เต็ม disk ของ host API — ล้างโดยเก็บ image ที่รันอยู่และตัวก่อนหน้า |
| กับดักการวัด | อย่าประเมินค่า log จาก `describe-log-groups`; `imageSizeInBytes` ของ ECR นับ layer ซ้ำ; ดู `NatGateway-Bytes` แยกจาก `-Hours` |

คำสั่ง `python3 infra/kamal/power-uat status|start|pause` ถูกอ้างใน runbook สำหรับ Plan A แต่ **ไม่พบไฟล์ `infra/kamal/power-uat` ใน commit นี้** (มีใน runbook แต่ไม่พบในโค้ด) และ `infra/kamal/README.md` ของ commit นี้ไม่มีหัวข้อ "UAT power and cost Plan A" ที่ runbook ลิงก์ถึง

### 5.5 การปฏิบัติการงบ AI

| กลไก | รายละเอียด | แหล่ง |
|---|---|---|
| งบรายเดือนต่อบริษัท | `AI_MONTHLY_BUDGET_SATANG` (ค่าเริ่มต้น 200000 = 2,000 บาท) และเพดานที่ผู้ดูแลปรับได้ `AI_MONTHLY_BUDGET_SATANG_CEILING`; ร้านฟรี `LINE_FREE_AI_BUDGET_SATANG` (8000 = 80 บาท) | config schema |
| การจองงบต่อขั้น | ก่อนเรียก provider แต่ละครั้ง API สร้างแถว `AiBudgetReservation` ภายใต้ advisory lock ของบริษัท-เดือน; เพดานต่อขั้นนิยามใน `packages/contracts/src/ai-budget-bounds.ts`; gateway ขออนุญาตขั้นถัดไปที่ `POST /internal/ai/budget-step` | `docs/adr/0013-ai-budget-split-reservations.md` |
| โหมด `SHARED`/`SPLIT` | `SHARED` เป็นค่าเริ่มต้น; `SPLIT` แยกเพดาน CHAT กับ OCR ภายในยอดรวม | ADR 0013 |
| การเรียกที่ล้ม | ตามมติเจ้าของ 2026-10-15 การเรียกที่รู้ว่าล้ม/ไม่ได้ผล บริษัทผู้ให้บริการรับภาระ (`COMPANY_ABSORBED`); hold ของลูกค้าถูกปล่อยเป็น `CANCELLED` | ADR 0013 (ส่วนแก้ไข) |
| Rate limit | `AI_LLM_MAX_PER_COMPANY`, `AI_OCR_MAX_PER_COMPANY` ต่อ `AI_RATE_LIMIT_WINDOW_SECONDS` | config schema |
| อัตราแลกเปลี่ยน | `AI_THB_PER_USD` เป็นค่าสำรอง (33) | config schema |
| นโยบายโมเดล | `APPROVED_AI_MODEL_IDS`, `APPROVED_AI_PROVIDERS`, `APPROVED_AI_REGIONS`; global inference profile ของ Bedrock ต้องมี `AI_GLOBAL_INFERENCE_PROFILE_APPROVED` + เลขอ้างอิงการอนุมัติ เพราะเป็นการประมวลผลข้ามพรมแดน | `validateProductionConfig` |
| Add-on เครดิตแชต/รูปใบเสร็จ | lot ของเครดิตที่ซื้อเพิ่มหรือให้เปล่า | `docs/specs/chat-credit-and-receipt-addons-spec-th.md` |
| การปรับด้วยมือ | คอนโซลผู้ดูแล (ทดสอบโดย `admin-ai-adjustments-smoke.ts`, `partner-ai-support-smoke.ts`) | — |
| การแจ้งเตือน | hold เครดิตค้างเกิน `AI_CREDIT_HOLD_ALERT_AFTER_HOURS` ชั่วโมง; งบร้านฟรีหมด (จำกัด `LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY`) | config schema |
| รายงาน | `scripts/line-ai-task-report.ts`, `apps/api/src/scripts/line-ai-reconciliation-report.ts` | — |
| โควตาผู้ให้บริการ | Bedrock ของบัญชีนี้: Sonnet 4.6 global = 10 request/นาที, Haiku 5.5 = 0; ขอเพิ่มผ่าน Service Quotas 2026-11-09 (ไม่มีผลก่อนปิด) | cloud runbook |
| ต้นทุนที่วัดได้ | เฉลี่ย ~0.6 บาท/turn สำหรับคำถามรายจ่าย (เอกสาร 07 หัวข้อ 6) | — |

---

## 6. การปฏิบัติการด้านความปลอดภัย

### 6.1 ตัวตนและ MFA ของ deploy role

| รายการ | รายละเอียด |
|---|---|
| Profile ปฏิบัติการ | `mangmee-kamal-uat`, `mangmee-kamal-production` (non-root, ใช้ release/เซ็น); `watchdog-bedrock` / IAM user `watchdog-bedrock-dev` (อ่าน Cost Explorer, Bedrock, dev); `thawatchai` = root ของบัญชี ใช้เฉพาะ bootstrap/ปลดระวางที่เจ้าของอนุมัติเป็นครั้ง ๆ |
| MFA | ตั้งแต่ 2026-10-21 `DeployRole` ของทั้งสอง stack บังคับ MFA; ทุกการกระทำกับ AWS ของ UAT/Production ต้องให้เจ้าของพิมพ์รหัส 6 หลักเอง (session ใช้ได้ราว 8 ชั่วโมง); รหัสอยู่ใน session ชั่วคราวเท่านั้น |
| Production | ต้องมี "go" ชัดเจนของเจ้าของหลังเขาตรวจ UAT เอง และเขาล็อกอินเบราว์เซอร์เองเพื่อ acceptance |
| GitHub | เดิม deploy ผ่าน OIDC role (`infra/prod-ecs-express/github-deploy-role-*.template.json`); `main` มี branch protection (ต้องมี approval ≥ 1) ที่ workflow ตรวจก่อน promote |
| ผู้ดูแลระบบของแอป | บัญชี seed ถูกแทนด้วยผู้ดูแลจริงผ่าน signed cutover (`system-admin-cutover.yml`); ห้ามใช้บัญชี seed หรือ reset รหัสเพื่อ acceptance |
| โหมดผู้ดูแลคนเดียว | เมื่อการควบคุมแบบสองคนทำไม่ได้ ระบบบันทึก `selfApproved` พร้อม guardrail (เช่น case สิทธิ์ข้อมูล P31 §8.7) |

### 6.2 การหมุน secret

| Secret | วิธี/ข้อควรรู้ |
|---|---|
| `PDPA_PSEUDONYMIZATION_KEY` | ย้าย key เดิมไป `PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS` (คั่นด้วยจุลภาค) แล้วตั้ง key ใหม่ |
| `EMAIL_OTP_HMAC_KEY` | เปลี่ยนพร้อมป้าย `EMAIL_OTP_HMAC_KEY_VERSION` |
| JWT signing key | หมุน 2026-10-22 (ถูกหมุนสองครั้งเพราะคำสั่งถูกโพสต์ซ้ำ — บทเรียน: โพสต์คำสั่งให้เจ้าของครั้งเดียว) |
| `WORKER_INTERNAL_TOKEN`, `AI_GATEWAY_INTERNAL_SECRET` | หมุนหลัง cutover เครือข่าย (`docs/runbooks/h-14-private-ingress-cutover-runbook.md`) |
| Credential ของ LINE ของร้าน | เก็บเข้ารหัสในฐานข้อมูลด้วย `CREDENTIAL_ENCRYPTION_KEY`; เผยแพร่ credential ร่วมได้โดยไม่ต้อง restart (ทดสอบโดย `line-runtime-credentials-smoke.ts`) |
| Stripe / Postmark / LINE | สร้างใหม่ที่ผู้ให้บริการ → ใส่ version ใหม่ใน Secrets Manager → release (ตัวควบคุมอ่าน secret version ก่อน mutation และตรวจซ้ำว่าไม่เปลี่ยนกลางทาง) |
| Access key ของ IAM | แผน 2026-10-23 ให้หมุน key ที่ลงท้าย `…7DOT` และตรวจว่ามี static root key หรือไม่ — สถานะ PLANNED ตอนปิด |
| SSH host key | `--reconcile-host-identity --accept-host-key-rotation --host-key-rotation-reason '…'` |

กฎที่โค้ดบังคับ: `AI_ACTOR_DELEGATION_SIGNING_KEY` ต้องไม่ซ้ำกับ `AI_GATEWAY_INTERNAL_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `PDPA_PSEUDONYMIZATION_KEY`; `PDPA_PSEUDONYMIZATION_KEY` ต้องต่างจาก `CREDENTIAL_ENCRYPTION_KEY`; actor-delegation key อยู่เฉพาะใน process ของ API (ไม่อยู่ใน Next หรือ container ของ AI)

### 6.3 การสแกนช่องโหว่และ waiver ของ CVE

| กลไก | รายละเอียด |
|---|---|
| Dependency | `pnpm security:audit` (ระดับ high); override ใน `package.json` ราก (`pnpm.overrides` 21 รายการ) ใช้ปิด advisory ของ dependency ทางอ้อม; patch `patches/pdfjs-dist@6.2.108.patch` |
| Image | `infra/docker/verify-ecr-scan.sh` + `ecr-scan-blocking-findings.jq`: fail-closed — HIGH/CRITICAL ที่ไม่มี waiver ตรงตัวบล็อก deploy และ `coverageComplete` บังคับว่าจำนวน finding ตรงกับที่ ECR รายงาน; **ใช้ใน `ci.yml` เท่านั้น** สาย Kamal ไม่มี gate นี้ (มติเจ้าของ 2026-09-19: สแกนเองเป็นรอบ) |
| Filesystem ของ image | `infra/docker/verify-production-image.sh`, SBOM SPDX ต่อ image |
| Secret scan | job `secret-scan` ใน `ci.yml` |
| ไฟล์อัปโหลด | ClamAV ใน container `api-web` + นโยบายเนื้อหา (`inspectAttachmentBytes`); หลักฐาน `docs/security-evidence/m14-*.md` |
| กฎการ bump base | ตรวจ `security-tracker.debian.org` ก่อน — ดึง digest ใหม่ไม่ช่วยถ้า Debian ยังไม่มี fix |

Waiver ledger (จาก `docs/runbooks/cloud-environment-operations.md` §ECR scan gate; waiver ต้องมี approval id ของเจ้าของและห้ามใช้ id เดิมต่ออายุ):

| วันที่ | CVE | หมดอายุ | Approval id |
|---|---|---|---|
| 2026-08-27 | CVE-2026-14456, -54874, -63072, -63076 (HIGH, openssl ของ bookworm) | 2026-09-10 | `CHAT-OWNER-DIRECTIVE-2026-08-27-FIX-ALL-UNTIL-DEPLOY-SUCCEEDS` |
| 2026-09-05 | CVE-2026-75803 (CRITICAL, openssl), CVE-2026-85091 (HIGH, zlib) | 2026-09-19 | `CHAT-OWNER-DIRECTIVE-2026-09-05-UAT-DEPLOY-WAIVER` |
| 2026-09-05 | ต่ออายุ 5 ตัว (-54874, -63072, -63076, -75803, -85091) | 2026-10-05 | `CHAT-OWNER-DIRECTIVE-2026-09-05-CVE-WAIVER-RENEWAL-2026-10-05` |
| 2026-09-05 | CVE-2026-14456 — ปลดออก (ECR ไม่รายงานแล้ว) | — | ตามกติกา M-18 |
| 2026-09-21 | CVE-2026-85091 (HIGH, zlib ของ trixie) | 2026-10-21 | `CHAT-OWNER-DIRECTIVE-2026-09-21-CVE-2026-85091-TRIXIE-WAIVER-2026-10-21` |

การย้ายเป็น trixie (2026-09-19) ปิด CVE ของ openssl สี่ตัว; Node 22.23.4 (base ปัจจุบัน) รับ fix ของ CVE-2026-111497 (Brotli RCE, High) ที่ release 2026-10-21 ยังเป็น 22.23.2

### 6.4 ประวัติเหตุการณ์ที่บันทึกในเอกสาร

| วันที่ | เหตุการณ์ | ผล/การแก้ | แหล่ง |
|---|---|---|---|
| 2026-07-17 | การประเมินความปลอดภัย (red team + การตรวจยืนยันอิสระ) | checklist แก้ไขรวม H-xx/M-xx/L-xx; แผน P1 (M-04…M-18), P2 (L-01…L-15), M-01 actor delegation | `docs/security-assessment-*-2026-07-17.md`, `docs/security-remediation-checklist-merged-2026-07-17.md`, `docs/plans/p1-*`, `p2-*`, `security-remediation-m-01-*` |
| 2026-08-05–07 | workers ของ UAT crash-loop จาก OOM → log ingest 214 GB ในวันเดียว; budget alert ที่ 173 USD | หยุด loop, เพิ่ม guard จำกัด log, ลบ NAT และ Redis เดิม; secret `redis-url` ของ production เคยชี้ endpoint ที่ถูกลบ | `docs/agent-memory/aws-cost-spike-2026-08.md` |
| 2026-08-08 | checksum ของ migration production drift | แก้ผ่าน bastion | `docs/runbooks/production-migration-reconciliation.md` |
| 2026-09-17 | LINE ledger incident | readback ใน cloud runbook | cloud runbook "LINE ledger incident readback" |
| 2026-09-25 | อีเมล `auth.email.security_notice` สถานะ DEAD → alarm ความปลอดภัยของ API ค้าง | เจ้าของยอมรับเป็นข้อยกเว้น 2026-10-09 โดยไม่ replay/ลบ | cloud runbook |
| 2026-09-30 | production: สมัครผ่าน LINE ล้ม (CHECK constraint ไม่รับ `SALES`); LINE AI ตอบ fallback (`ROUTER_UNREACHABLE`) เพราะ client ของ rate limit บน Redis timeout | hotfix constraint; ไม่ restart; พบว่า liveness ไม่ครอบคลุมเส้นทางที่พึ่ง Redis | `docs/agent-memory/prod-line-incident-2026-09-30.md` |
| 2026-10-01 | Redis stalled connection และการวินิจฉัย LINE login | readback | cloud runbook |
| 2026-10-07 → 10-09 | ปลดระวางทั้งหมดแล้วกู้กลับ | พิสูจน์ว่ากู้จาก backup offline ได้; webhook ของ LINE ต้องชี้ origin ใหม่ด้วยมือ | cloud runbook |
| 2026-10-21 | readback ความปลอดภัย production | finding ที่เปิด: request สาธารณะถึง AI origin ไปถึง JSON parser ก่อน auth ภายใน; container ไม่มี cap-drop/no-new-privileges และ root filesystem เขียนได้; log group ไม่มี KMS ของลูกค้า; alarm ความปลอดภัยยัง ALARM | cloud runbook "Production security readback" |
| 2026-10-21/23 | แผนแก้ความปลอดภัยและ ops follow-up | dependency (SEC-02) และชื่อบริษัท (SEC-04) ลงโค้ดแล้ว; ส่วน cloud เป็น PLANNED | `docs/agent-memory/security-fix-plan-2026-10-21.md`, `docs/plans/ops-followups-2026-10-23-plan.md` |
| 2026-10-28 | Halloween: ทบทวนและแก้ความปลอดภัยของเกม; ยกเลิกการเซ็นผลจับรางวัล | ไม่มีการสร้าง key ใน production | `docs/runbooks/halloween-draw-signing.md`, `docs/evidence/halloween-security-*` |

เอกสาร PDPA ที่เกี่ยว: `docs/security-evidence/` (ROPA, ทะเบียน processor/ข้ามพรมแดน, retention, การประเมิน DPO), `docs/legal-review/`, `docs/runbooks/user-company-data-rights.md`

---

## 7. ดัชนี runbook

ทุกไฟล์ใต้ `docs/runbooks/` (27 ไฟล์ ณ commit `08850deaf`)

| ไฟล์ | สรุป |
|---|---|
| `b1-b2-line-external-setup.md` | ขั้นตอนฝั่ง LINE console และการกรอกในแอปเพื่อเชื่อม LINE OA (B1) และ OA ร่วม/rich menu (B2); ฝั่ง ERP พร้อมแล้ว เหลืองาน console |
| `billing-document-correction-manual.md` | วิธีแก้ชื่อ/ที่อยู่/เลขภาษีของใบแจ้งหนี้ที่จ่ายแล้วด้วยมือ เป็นทางชั่วคราวเพราะ engine "reissue" ไม่ได้สร้าง |
| `cloud-environment-operations.md` | บันทึกสถานะ cloud ที่อ่านจาก AWS จริง: อะไรรันอยู่, เปิด/ปิดอย่างไร, ค่าใช้จ่าย, กับดักของ CLI และ ledger ของทุก release — ต้องอ่านก่อนแตะ cloud ทุกครั้ง |
| `customer-journey-signal-triage.md` | การคัดแยกเมื่อ signal ของ customer journey หาย/ซ้ำ/ช้า โดยใช้ dashboard และ correlation ID; ห้าม retry การเงินก่อนตรวจ idempotency |
| `feature-launch-control.md` | สัญญาของ launch-health view และ runbook ราย route สำหรับเปิด/ปิดฟีเจอร์ รวมการปิดฉุกเฉิน (R3) |
| `h-14-private-ingress-cutover-runbook.md` | แผน cutover ให้ `workers` และ `ai-gateway` ไม่มี endpoint สาธารณะ แล้วหมุน token ภายใน (เตรียมไว้ ยังไม่ได้ทำในยุค ECS) |
| `halloween-draw-signing.md` | ประกาศยกเลิก key เซ็นของกิจกรรม Halloween (2026-10-28); ไม่ต้องสร้าง secret |
| `legal-release-evidence-bundle.md` | ขั้นตอนประกอบชุดหลักฐานกฎหมาย 5 ไฟล์สำหรับเปิด production; manifest ที่ check-in ยังเป็น `BLOCKED` |
| `line-ai-local-agent-10b-runbook.md` | รัน LINE AI agent ในเครื่องกับโมเดลจริง (Bedrock เป็นหลัก) ผ่าน tunnel และ LINE channel ของนักพัฒนา |
| `line-first-signup-support-playbook.md` | คู่มือทีม support สำหรับการสมัครผ่าน LINE: สมัครใหม่หลังถูกปฏิเสธ, คำขอคุยกับเจ้าหน้าที่, การกู้บัญชี |
| `line-rich-menu-v2-console-setup.md` | ตั้ง rich menu V2 (bitmap 2500×1686 + manifest) ด้วย `scripts/line-oa/apply-rich-menu.mjs` แบบ stage แล้ว activate |
| `local-proof-stack-and-merge-gate.md` | proof stack สามชุด, journey test, merge gate และ re-pin ในเครื่อง |
| `mvp-1-dev-a-cutover-runbook.md` | checklist cutover ของงาน CRM/LINE bill-capture MVP 1 (ยุค ECS canary + rollback alarm) |
| `p1-production-security-operations.md` | การปฏิบัติการความปลอดภัย P1: หลักฐาน alert (M-16), การกู้ RDS/Redis และซ้อมรายไตรมาส (M-17), ข้อยกเว้นช่องโหว่ (M-18) |
| `partner-onboarding-e2e.md` | เส้นทางเต็ม: ผู้ดูแลสร้างบริษัทคู่ค้า → เชื่อม LINE OA → ลูกค้าคุย AI → พนักงานตอบใน CRM Inbox |
| `postmark-environment-activation.md` | เปิดใช้และ rollback Postmark ต่อ environment (UAT เปิด 2026-09-16), webhook และ allowlist ผู้รับ |
| `production-a5-u5-promotion-ceremony.md` | แผนที่ ceremony V1 (A5/U5) — ถูก freeze ตั้งแต่ 2026-08-12 เก็บเป็นเอกสารอ้างอิง |
| `production-golive-aws-commands.md` | คำสั่ง AWS ตามลำดับสำหรับ go-live ครั้งแรก (2026-08) พร้อมคำสั่งยืนยันทุกขั้น |
| `production-migration-reconciliation.md` | บันทึกการแก้ checksum drift ของ migration บน production (แก้แล้ว 2026-08-08) |
| `production-promotion-prerequisite-bootstrap.md` | ขอบเขตครั้งเดียวสำหรับแก้ IAM contract ของการ promote production โดยผู้ดูแลที่ไม่ใช่ root |
| `production-stripe-live-enablement.md` | สี่ค่าที่ต้องมีเพื่อเปิด Stripe live และที่เก็บแต่ละค่า |
| `production-support-access.md` | บันได T0–T2 สำหรับ query/แก้ข้อมูล production ผ่าน bastion และ break-glass |
| `ses-email-setup.md` | ขั้นตอนตั้ง AWS SES สำหรับเจ้าของ (เขียน 2026-08-30; ระบบเลือก Postmark แทนในภายหลัง) |
| `uat-feature-package-provisioning.md` | เปิดแพ็กเกจฟีเจอร์ให้บริษัท UAT เพื่อทดสอบ journey เอกสาร/ภาษี/รายงาน |
| `uat-production-v2-deployment.md` | protocol บังคับ UAT → READY → Production, ข้อยกเว้นที่เจ้าของอนุมัติเป็นกรณี, failure/retry และหลักฐานรอบที่ผ่าน |
| `user-company-data-rights.md` | การจัดการคำขอสิทธิ์ของเจ้าของข้อมูลและการออกจากระบบของบริษัท (การควบคุมด้วยมือชั่วคราว) |
| `username-case-uniqueness-followup.md` | เงื่อนไขและ query ก่อนยกระดับ index `User_username_lower_idx` เป็น UNIQUE |

Runbook เสริมนอกโฟลเดอร์: `infra/kamal/README.md`, `infra/docker/README.md`, `infra/prod-ecs-express/README.md`, `infra/uat/README.md`, `infra/line-official/README.md`, `e2e/HANDOFF.md`

---

## 8. คู่มือบำรุงรักษา

### 8.1 ตั้งเครื่องนักพัฒนาจากศูนย์

1. ติดตั้ง Git, Node.js 22 (ตรง base image `node:22.23.4`), corepack, Docker, PostgreSQL client (`psql`), Python 3 (สำหรับ `infra/kamal`), และ (ถ้าจะแตะ cloud) AWS CLI v2 + session-manager-plugin
2. `corepack enable` — repo กำหนด `packageManager: pnpm@9.15.0`; workspace คือ `apps/*` และ `packages/*` (`pnpm-workspace.yaml`); dependency ที่อนุญาตให้รัน build script: `@prisma/engines`, `esbuild`, `msgpackr-extract`, `prisma`, `sharp`
3. `pnpm install` (ใช้ lockfile; มี patch `patches/pdfjs-dist@6.2.108.patch`)
4. `cp .env.example .env`
5. ทางเลือก ก (ง่ายสุด): `pnpm docker:local` → web `:3000`, API `:3001`, gateway `:3002`
6. ทางเลือก ข (สำหรับพัฒนา/ทดสอบ): `pnpm docker:local:infra` หรือ PostgreSQL/Redis/MinIO native → `pnpm --filter @watchdog-bms/config build && pnpm --filter @watchdog-bms/contracts build` → `pnpm --filter @watchdog-bms/api exec prisma migrate deploy && … prisma generate && … tsx prisma/seed.ts` → `e2e/run-local.sh --grep @smoke` เพื่อยืนยันทั้งชุด
7. ตั้ง `scripts/local-proof/settings.local.sh` จาก `settings.example.sh` แล้วรัน `bash scripts/local-proof/gate.sh first-proof`
8. ตรวจ `apps/api/.env` ไม่ให้ทับ `DATABASE_URL`; จำ port: compose PostgreSQL `15432`, native `5432`, tunnel UAT `55432`

ข้อควรรู้ของเครื่องมือ: web ใช้ Turbopack ตอน `next dev` และ webpack ตอน `next build --webpack` — loader rule ต้องลงทะเบียนทั้งสอง; typecheck ของ API ต้องใช้สคริปต์แพ็กเกจ (heap 8 GB); หน้า public ของ Next ที่ใช้ CSP nonce ต้อง `force-dynamic`; งานหนักในเครื่อง 16 GB ใช้ lock ร่วม (`scripts/local-proof/heavy.sh`)

### 8.2 ข้อตกลงของ repo (`AGENTS.md`, `CLAUDE.md`)

| กฎ | เนื้อหา |
|---|---|
| Docs เป็นแหล่งความจริง | `docs/` เก็บ product, spec, plan, ADR, research, prompt; เริ่มที่ `docs/Home.md` (ADR 0001) |
| Docs-first | ฟีเจอร์หลักต้องมี spec และ plan ก่อนลงมือ; template ที่ `docs/_templates/` (`feature-spec-template.md`, `implementation-plan-template.md`, `adr-template.md`) |
| Task memory | บันทึก `docs/agent-memory/<task>.md` เมื่องานข้ามหลายรอบ/หลายโมดูล หรือแก้ docs กับโค้ดพร้อมกัน ตาม template: Status, Owner, Scope, Decisions, Open questions, Artifacts, Verification, Next (มี 868 ไฟล์ตอนปิด) |
| Ponytail rule | อ่าน `.agents/skills/ponytail/SKILL.md` ก่อนแก้โค้ด (สำเนาสำหรับ Claude ที่ `.claude/skills/ponytail/`): diff ที่สั้นที่สุดซึ่งถูกต้อง, ใช้ pattern เดิมก่อน, ไม่มี abstraction เผื่ออนาคต, ไม่เพิ่ม dependency เว้นจำเป็น, มีการตรวจที่รันได้หนึ่งอย่างสำหรับ logic ที่ไม่เล็ก — `AGENTS.md` อ้าง path แบบ absolute ของเครื่องอื่น (`/Users/spare058/WatchDog-BMS/…`) ซึ่งต้องอ่านเป็น path ใน repo |
| กฎ `package.json` | ห้ามแก้/commit/push `package.json` ใด ๆ เว้นแต่เพิ่ม ลบ หรืออัปเดต dependency — การแก้ script/metadata/ลำดับทำให้ merge conflict บ่อย (ผลข้างเคียง: spec ใหม่ต้องถูกระบุในสคริปต์ `test` จึงเป็นข้อยกเว้นที่ต้องทำอย่างตั้งใจ หรือใส่ใน whole-chain catalog แทน) |
| ขอบเขต AI | AI Gateway แยกจาก ERP core และเรียกผ่าน API/tool ที่ตรวจสิทธิ์แล้วเท่านั้น ไม่เข้า repository ของฐานข้อมูลตรง |
| ขอบเขตความปลอดภัย | security, tenant, permission, audit, source-state และ final-mutation ต้องชัดเจน |
| ก่อนแตะ cloud | อ่าน `docs/runbooks/cloud-environment-operations.md`; ก่อน deploy/promote/recover อ่าน `uat-production-v2-deployment.md` |
| Escalation | ติดเรื่องผลลัพธ์ผลิตภัณฑ์/นโยบาย/contract/สิทธิ์ที่ไม่ชัด ให้ถามคำถามเดียวที่แม่นยำ บันทึกสถานะ แล้วหยุด ห้ามเดา |
| Subagent | ไม่ใช้ role subagent หรือ delivery-chain subagent แบบเดิม |
| Branch | `develop` และ `main` (tree เดียวกันตอนปิด; commit บน main ระบุ "same tree as develop …"); ช่วงท้าย push ตรงโดยไม่มี PR หลัง gate ในเครื่องเขียว |
| ภาษา | UI และเอกสารถึงเจ้าของเป็นภาษาไทยคำธรรมดา; ศัพท์บัญชีใช้เฉพาะรายงานถึงนักบัญชี/กรมสรรพากร |

### 8.3 โครงสร้างโมดูลและวิธีเพิ่มสิ่งใหม่

โมดูลของ API (`apps/api/src/modules/<ชื่อ>/`) แบ่งชั้น `domain/` (models, logic, ports), `application/` (use-cases, services), `infrastructure/` (repository ของ Prisma, adapter), `presentation/http/` (controller, DTO) และไฟล์ `<ชื่อ>.module.ts` ที่ลงทะเบียนใน `apps/api/src/app.module.ts`; ฝั่ง web คือ `apps/web/src/features/<ชื่อ>/` กับ route ใต้ `apps/web/app/`

| ต้องการเพิ่ม | ขั้นตอน |
|---|---|
| โมดูล/ฟีเจอร์ | (1) spec + plan ใน `docs/` (2) contract ใน `packages/contracts/src/` แล้ว export จาก `index.ts` (3) โมดูล API ตามชั้นข้างต้น + ลงทะเบียนใน `app.module.ts` (4) หน้าจอใน `apps/web` (5) spec ทุกชั้น + ลงทะเบียน path ในสคริปต์ (6) journey test ถ้าเป็นฟีเจอร์ที่ขาย (7) อัปเดตคู่มือผู้ใช้/ถ้อยคำ แล้ว re-pin ถ้าแตะไฟล์ที่ถูก guard |
| Permission | เพิ่ม `PermissionDef` ใน `PERMISSIONS` และผูกใน `ROLE_GRANTS` (และ `SYSTEM_ROLES` ถ้าเป็นบทบาทใหม่) ที่ `apps/api/src/modules/auth/permission-registry.ts` → ใช้กับ guard ของ controller → `apps/api/prisma/sync-permissions.ts` จะ sync ลงฐานข้อมูลตอน release (รวม backfill ของบทบาทบริษัทจาก `employee-access/domain/registries/company-role-backfill.registry`) → ตรวจด้วย `permission-registry.spec.ts`, `sync-permissions.spec.ts`, `packages/contracts/src/access-matrix.ts` |
| Entitlement / ฟีเจอร์ของแพ็ก | เพิ่มใน `FEATURE_CATALOG` (`packages/contracts/src/feature-entitlements.ts`) พร้อม dependency ใน `FEATURE_DEPENDENCIES` → ผูกเมนูใน `MENU_ENTITLEMENT_BINDINGS` และกำหนดแพ็กใน `FEATURE_PACKAGE_PRESETS`/`TIER_FEATURE_PRESETS` (`menu-entitlements.ts`) → ขีดจำกัดของ tier ใน `PLAN_TIER_PRESETS` (`plan-term.ts`) → ตรวจด้วย `feature-entitlements.spec.ts`, `billing-feature-entitlements*.spec.ts`; ฟีเจอร์ใหม่เป็น deny-by-default สำหรับบริษัทเดิม (ดู `uat-feature-package-provisioning.md`) และ launch gate sync ด้วย `sync-feature-launch-gates.ts` |
| Migration | หัวข้อ 4.1; ถ้าเพิ่ม enum ต้องให้ `packages/contracts/src/prisma-enum-parity.spec.ts` ผ่าน |
| Environment variable | เพิ่มใน schema ที่ `packages/config/src/index.ts` (พร้อมกฎ production ถ้าจำเป็น) → `.env.example` → `infra/docker/compose.local.yml` → ถ้าเป็นค่าที่ไม่ใช่ secret ของ cloud ใส่ `infra/kamal/config.json`; ถ้าเป็น secret ต้องมี reference ใน baseline ของ environment ก่อน release — ตัวควบคุมไม่สร้างค่า secret ให้ หลักของเจ้าของช่วงท้าย: ไม่ gate ฟีเจอร์ด้วย environment flag (always-on) |
| เครื่องมือของ LINE AI | เพิ่ม tool ฝั่ง API (ตรวจสิทธิ์) และ registry ฝั่ง gateway ให้ `agent-tools.parity.spec.ts` ผ่าน → อัปเดต capability manifest (`docs/research/mangmee-ai-capability-manifest-2026-09-27.json`) → เพิ่ม scenario ใน whole-chain catalog → รัน whole-chain ก่อน push |
| Worker job | โมดูลใต้ `apps/workers/src/modules/` + spec + ลงทะเบียนใน `apps/workers/package.json` |
| ข้อความช่วยเหลือของ LINE | แก้คู่มือผู้ใช้ทำให้ hash ของ help pack เปลี่ยน — ต้องออกชุดที่ review ใหม่และ re-pin; ชุดปัจจุบันหมดอายุ 2026-12-27 |

### 8.4 นโยบายอัปเดต dependency

- อัปเดตผ่าน `pnpm` และ lockfile เท่านั้น; การแก้ `package.json` อนุญาตเฉพาะเรื่อง dependency
- Gate: `pnpm security:audit` ระดับ high ต้องผ่าน; ช่องโหว่ทางอ้อมแก้ด้วย `pnpm.overrides` แบบ caret และต้องพิสูจน์ที่ runtime (เช่น render เอกสารด้วย `sharp` รุ่นใหม่เทียบภาพเดิมแบบ pixel)
- Dependency ที่มี native binary (`sharp`, `@prisma/engines`) มี pin ใน Dockerfile ที่ต้องขยับพร้อมกัน และเป็นไฟล์ที่ถูก guard → re-pin
- Base image: pin ด้วย digest ทั้งหก Dockerfile พร้อมกัน; ตรวจ Debian security tracker ก่อน; ทดสอบ A/B ตามตัวอย่าง `docs/qa/evidence/base-image-trixie-ab-*.md`
- Model ของ AI: เปลี่ยนต้องเพิ่มใน `APPROVED_AI_MODEL_IDS`, ผ่านชุดวัด (เอกสาร 07 หัวข้อ 6) และ release ใหม่เพื่อให้ AgentCore ได้ค่า; price map ที่ pin ไว้ต้องอัปเดตตาม
- เครื่องมือ release: Kamal 2.12-compatible proxy v0.9.2 (pin digest ใน `bootstrap-host.sh`), PostgreSQL 18.3 บน cloud (local compose ใช้ 16), Redis 7.1

---

## 9. บันทึกการปลดระวาง (decommission)

### 9.1 สิ่งที่ถูกปิด — 2026-11-15/16 (เวลาไทย)

ที่มา: `docs/agent-memory/prod-uat-power-down-2026-11-15.md` และส่วนบนของ `docs/runbooks/cloud-environment-operations.md` ฉบับ 2026-11-16 (ทั้งสองอยู่ใน working tree ของเจ้าของ ไม่อยู่ใน commit `08850deaf`) คำสั่งของเจ้าของ: "หยุดทุกอย่างที่เสียเงินและ back-up ข้อมูลไว้บนเครื่อง mac เครื่องนี้" ขอบเขตคือ AWS account `311414082667`, workload ของ Production และ UAT ใน `ap-southeast-1`

| หมวด | สิ่งที่ทำ |
|---|---|
| Compute | terminate host ของ Production และ UAT ทั้งหมด; ไม่เหลือ instance, volume, EBS snapshot, ECS/App Runner service หรือ Lambda |
| ฐานข้อมูลและ cache | ลบ RDS และ ElastiCache หลัง export; ลบ automated snapshot ของ ElastiCache ทั้งหมด; ยืนยันว่าไม่มี final snapshot หรือ backup ของ RDS เหลือ |
| เครือข่าย | ลบ load balancer; ไม่เหลือ NAT gateway หรือ VPC endpoint |
| Registry และ storage | ลบ ECR repository และ S3 bucket ของแอป |
| Observability | ลบ log, alarm; หยุด CloudTrail (trail หลายภูมิภาค) หลังดาวน์โหลดการส่งครั้งสุดท้าย แล้วลบ trail และ bucket — **บัญชีไม่มี CloudTrail logging แล้ว** |
| Secret | ลบ secret และ SSM parameter ของขอบเขตนี้ |
| Stack | ลบ stack `mangmee-uat-power`; ไม่เหลือ CloudFormation stack ของแอปที่ active |
| AgentCore | ลบ runtime และ endpoint ของ Production และ UAT และ workload identity ของ UAT; `list-agent-runtimes` คืนค่าว่าง |
| KMS | key เซ็น release ของ Kamal ทั้งสอง (customer-managed) อยู่ใน `PendingDeletion` กำหนดลบราว **2026-11-23 02:20 เวลาไทย**; ใช้เซ็นไม่ได้ทันที; ไม่คิดค่ารายเดือนระหว่างรอลบ; private key export ไม่ได้ |
| การตรวจสุดท้าย | 24 รายการตรวจระดับ service/global; สแกน tag ของ 18 region ที่เปิดใช้ไม่พบ resource นอก `ap-southeast-1`; ไม่มี Route 53 zone/โดเมน, CloudFront, Global Accelerator, WAF ระดับ CloudFront หรือ provisioned throughput ของ Bedrock; Resource Groups Tagging API ยังคืนรายการเก่าของ resource ที่ถูกลบ — ให้เชื่อ API ของ service โดยตรง |
| ค่าใช้จ่าย | Cost Explorer รายงาน 356.9069 USD ทั้งบัญชีสำหรับ 2026-11-01 ถึง 2026-11-15 (ยอดสะสม; ใบแจ้งหนี้อาจยังรวมการใช้ก่อนปิด) |
| นอกขอบเขตของรอบนี้ | Dev, Official OA (ถูกปลดตั้งแต่ 2026-10-07) และบัญชี/subscription ของผู้ให้บริการภายนอก — จัดการในภาคผนวก 9.4 |

ไม่มีการแก้ source code หรือ deploy ในงานปลดระวาง

### 9.2 สิ่งที่สำรองไว้ (2026-11-15)

| รายการ | รายละเอียด |
|---|---|
| ที่เก็บ | โฟลเดอร์ `~/.codex/offline-backups/20261115-prod-uat/` และ archive `~/Documents/WatchDog-BMS-Prod-UAT-Backup-2026-11-15.tar.gz` บน Mac ของเจ้าของ (FileVault เปิด; ไฟล์เป็น owner-only) — ภายหลังรวมไว้ใต้ `Downloads/ไฟล์สำรอง` ตามภาคผนวก 9.4 |
| ดัชนี | `BACKUP-MANIFEST.json` (เนื้อหาและ checksum), `README.md` ของเจ้าของ |
| PostgreSQL | dump ของ Production และ UAT; restore ในเครื่องแล้ว: Production 283 ตาราง / 410,889 แถว, UAT 283 ตาราง / 134,563 แถว |
| Redis | dump ของ DB0 ทั้งสอง environment; restore ลง Redis ชั่วคราวและตรวจจำนวน key แล้ว |
| S3 | 32,151 object version (744,251,040 bytes) ตรวจกับ ETag และ SHA256 ในเครื่อง |
| CloudWatch | 3,092,150 event (gzip stream พร้อม hash) |
| Secret และ config | secret, resource configuration, config ของ AgentCore runtime |
| Image | image ปัจจุบันของ Production/UAT: manifest ไม่ซ้ำ 3 ตัว, 6 tag พร้อม SHA256 ของ archive |
| KMS | metadata, policy, grant และ public key ของ key เซ็น |
| CloudTrail | object version ที่ส่งมอบทั้งหมด + ใบรับการหยุด/ลบ |
| หลักฐานการล้าง | `cleanup-evidence/final-live-inventory-2026-11-16.json`, `cleanup-evidence/cloudtrail-delete-receipt.json`, `cloud-config/cost-explorer-20261101-to-20261116.json` |
| Backup รุ่นก่อน | 2026-10-07: `mangmeeplus-prod-uat-backup-20261007.tar.gz` (573,721,632 bytes; dump 5 ชุด, S3 704 version) และ `mangmeeplus-retirement-supplement-20261007.tar.gz` (884,725,809 bytes; ไฟล์ Dev, RDB ของ Redis, โค้ด Official OA, artifact ของ AgentCore, CloudTrail/CloudWatch, credential และ config การกู้) |

### 9.3 ข้อจำกัดของการกู้

1. **Redis DB15 ของ UAT ไม่อยู่ใน dump ใหม่** — มี RDB วันที่ 7 ต.ค. ในเครื่องที่มี 1,017 key เท่ากับจำนวนใน manifest แต่พิสูจน์ไม่ได้ว่าค่าตรงกับของที่ถูกลบ
2. **PostgreSQL ของ Production** restore ได้ครบ 283 ตาราง / 410,889 แถว แต่ต้นทางไม่มี hash รายตารางให้เทียบความนิ่งของ snapshot (UAT เทียบได้)
3. **Image เก่าไม่ถูกเก็บ** — มีเฉพาะ image ปัจจุบัน 3 manifest; layer ของ image ย้อนหลังใน ECR หายไป ต้อง build จาก source
4. **Key เซ็นกู้ไม่ได้** — เมื่อพ้นกำหนดรอ key ถูกลบถาวรพร้อม private key เพียงชุดเดียว; ลายเซ็นของ release เก่ายังตรวจได้ด้วย public key ที่เก็บไว้ แต่การ deploy ใหม่ต้องสร้าง key ใหม่และแก้ config (`signingKeyArn`, `trustedUatSigningKeyArn`); ห้ามยกเลิกการลบเว้นแต่จะกลับมาเซ็น release ของ environment เดิม
5. **CloudTrail ปิดทั้งบัญชี**
6. **Cost Explorer ล่าช้า** — ใบแจ้งหนี้อาจยังมีการใช้ก่อนปิด
7. **Secret ดิบอยู่ใน backup** — เก็บบนเครื่องที่เข้ารหัสเท่านั้น ห้ามอัปโหลดหรือแชร์; และ secret ของผู้ให้บริการภายนอกในนั้นถูกหมุน/เพิกถอนแล้ว (9.4) จึงใช้ต่อไม่ได้
8. **ชุดข้อสอบ AI ที่เก็บนอก repo** (held-out และ blind v4–v14) ไม่อยู่ใน backup ที่บันทึกไว้ข้างต้น — สถานะไม่ทราบ

### 9.4 ภาคผนวกการปิด — 2026-11-16 (ทำหลังบันทึกข้างต้น)

ข้อเท็จจริงต่อไปนี้ได้รับจากเจ้าของโครงการเป็นข้อมูลนำเข้าของเอกสารนี้ ไม่มีบันทึกใน commit ที่ตรวจ และไม่ได้ตรวจกับระบบของผู้ให้บริการ

| ผู้ให้บริการ | สิ่งที่ทำ | ผลต่อการกู้ |
|---|---|---|
| AWS | ยื่นปิดบัญชี `311414082667` แล้ว (เปิดกลับได้ภายในราว 90 วัน) | หลังพ้นช่วงนั้นต้องใช้บัญชีใหม่; ARN, account ID ที่ hard-code ใน `infra/` ต้องเปลี่ยน |
| Stripe | ปิด webhook และหมุน key แล้ว | `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` ใน backup ใช้ไม่ได้; ต้องสร้าง endpoint และ key ใหม่; Price ID ของ catalog ขึ้นกับบัญชี |
| Postmark | ปิดบัญชีแล้ว | ต้องเปิดบัญชี/server ใหม่, ยืนยันโดเมน (DKIM/Return-Path) และแก้ `infra/postmark/config.json` (`POSTMARK_SERVER_ID`) |
| LINE — OA ของร้าน `@458wpnio` | ตั้งข้อความตอบอัตโนมัติว่าปิดบริการ, ปิด webhook, ออก key ใหม่ | channel secret/access token ใน backup ใช้ไม่ได้ |
| LINE — OA ทางการและ OA ของ UAT | เพิกถอน access token เดิมแล้ว | ต้องออก token ใหม่ก่อนใช้ |
| Cloudflare | ลบ DNS record ที่ชี้ไป AWS/Postmark และลบโปรเจกต์ Workers/Pages ของผลิตภัณฑ์นี้; ปิด auto-renew ของโดเมน (หมดอายุ 2027-07-05) | ต้องสร้าง record, Worker และกฎ redirect ใหม่ทั้งหมด; ต้องต่ออายุโดเมนก่อนวันหมดอายุถ้าจะใช้ชื่อเดิม |
| GitHub | archive repository `MangmeeDev/mangmeeplus` และ `MangmeeDev/mangmee_web`; สำเนา private ของ `main` อยู่ที่ `sandwich09/mangmeeplus` และ `sandwich09/mangmee_web` | repo ที่ archive เป็น read-only; workflow อ้าง `MangmeeDev/mangmeeplus` และ actor `MangmeeDev` ต้องแก้ถ้าย้ายองค์กร |
| Backup ในเครื่อง | อยู่ใต้โฟลเดอร์ `Downloads/ไฟล์สำรอง` ของเจ้าของ: dump ฐานข้อมูล, object ของ S3, log, image, git bundle ของทุก branch และงานที่ยังไม่ commit | เป็นแหล่งเดียวของข้อมูลลูกค้าและของ branch ที่ไม่ใช่ `main` |

---

## 10. Checklist การสร้างระบบขึ้นใหม่

ลำดับสำหรับทีมใหม่ที่เริ่มจาก archive (โค้ด `main` ที่ `08850deaf` หรือ git bundle, backup ในหัวข้อ 9.2) แต่ละขั้นอ้างหัวข้อที่อธิบายรายละเอียด

**ก. เตรียมโค้ดและเครื่อง**

1. กู้ repo จากสำเนา private หรือ git bundle; ตรวจว่า `main` อยู่ที่ commit ที่ต้องการ และอ่าน `AGENTS.md`, `docs/Home.md`
2. ตั้งเครื่องตามหัวข้อ 8.1 และพิสูจน์ในเครื่องก่อน: `pnpm install` → build `config`/`contracts` → migrate + seed → `bash scripts/local-proof/gate.sh <tag>` ให้ได้ `GATE GREEN` (คาดว่าจะเจอ spec ที่ขึ้นกับวันที่ — ดูเอกสาร 07 หัวข้อ 4.2 และชุดช่วยเหลือ LINE ที่หมดอายุ 2026-12-27)
3. รัน `python3 infra/dev-kamal/build-complete.py` บน checkout สะอาดเพื่อยืนยันว่า image ทั้งสี่และ archive ของ AgentCore build ได้

**ข. บัญชี cloud และโครงสร้างพื้นฐาน**

4. เปิดบัญชี AWS ใหม่ (หรือเปิดบัญชีเดิมกลับภายใน ~90 วัน); สร้างผู้ดูแลที่ไม่ใช่ root พร้อม MFA; เปิด CloudTrail, AWS Budget และ Cost Anomaly Detection ตั้งแต่วันแรก
5. แทนค่า account/region ที่ hard-code: `ACCOUNT`/`REGION` ใน `infra/kamal/release_source.py`, `first_migration.py`, `prepare-production-stack.py`, `infra/dev-kamal/capture-config.py` และ template ของ IAM policy
6. ขอโควตา Bedrock ของ model ที่ใช้ (บัญชีเดิมถูกจำกัด Sonnet 4.6 ที่ 10 request/นาที) และขออนุมัติ global inference profile ถ้าจะใช้ (ต้องมีเลขอ้างอิงการอนุมัติด้านคุ้มครองข้อมูล)
7. สร้าง stack ต่อ environment (ใช้ `infra/kamal/prepare-production-stack.py` เป็นจุดเริ่มสำหรับ production): VPC + subnet 2 AZ, EC2 ตามหัวข้อ 1.3 (UserData จาก `bootstrap-host.sh` ผ่าน `prepare-bootstrap-update.py`), instance profile + SSM, ALB + ACM certificate, RDS PostgreSQL 18.3, ElastiCache Redis 7.1 (TLS + auth), S3 bucket (versioning, lifecycle, CORS, บล็อก SSE-C, บล็อก public), ECR repository (tag immutable), CloudWatch log group, SNS topic สำหรับ alarm
8. สร้าง **KMS asymmetric signing key ใหม่** ต่อ environment (key เดิมกู้ไม่ได้) และให้สิทธิ์ sign/verify แก่ deploy role; production ต้องมีสิทธิ์ verify ของ key UAT
9. สร้าง AgentCore runtime ต่อ environment พร้อม endpoint สองตัว (ใช้งาน + สำรอง) และ execution role ตาม `infra/ai-gateway/agentcore-execution-role-*.json`, `bedrock-invoke-policy.json`

**ค. Secret และผู้ให้บริการภายนอก**

10. สร้าง secret ใหม่ทุกตัวที่ repo สร้างเอง (ห้ามใช้ค่าจาก backup ถ้าไม่จำเป็น): `WATCHDOG_JWT_SECRET_ARN`, `WORKER_INTERNAL_TOKEN`, `AI_GATEWAY_INTERNAL_SECRET`, `AI_ACTOR_DELEGATION_SIGNING_KEY`, `EMAIL_OTP_HMAC_KEY` — **ยกเว้นสองตัวที่ต้องใช้ค่าเดิมจาก backup ถ้าจะ restore ข้อมูลเดิม:** `CREDENTIAL_ENCRYPTION_KEY` (ถอดรหัส credential ของ LINE OA ร้านที่เก็บในฐานข้อมูล) และ `PDPA_PSEUDONYMIZATION_KEY` (+ previous keys) มิฉะนั้นข้อมูลที่เข้ารหัส/ทำ pseudonym ไว้จะอ่านไม่ได้
11. LINE: สร้างหรือออก credential ใหม่ของ LINE Login channel, LIFF app, Messaging API channel ของ OA ระบบ และ OA ทางการ; ใส่ `LINE_LOGIN_CHANNEL_ID/SECRET`, `LINE_LIFF_ID`, `LINE_MESSAGING_CHANNEL_ID/SECRET/ACCESS_TOKEN`, `LINE_OFFICIAL_CHANNEL_SECRET/ACCESS_TOKEN`; ตั้ง rich menu ด้วย `scripts/line-oa/apply-rich-menu.mjs` (`docs/runbooks/line-rich-menu-v2-console-setup.md`)
12. Stripe: สร้าง key และ webhook endpoint ใหม่; สร้าง Price ตาม catalog (`apps/api/src/scripts/create-catalog-prices.ts`) และเผยแพร่ billing policy ที่มี Price ID ใหม่; ใส่ `STRIPE_ACCOUNT_ID` ใน `infra/kamal/config.json` (`docs/runbooks/production-stripe-live-enablement.md`)
13. Postmark: เปิด server ต่อ environment, ยืนยันโดเมนผู้ส่ง, ตั้ง webhook `/v1/public/postmark-events` พร้อม basic auth, แก้ `infra/postmark/config.json` (`docs/runbooks/postmark-environment-activation.md`)
14. ใส่ secret ลง Secrets Manager ตามชื่อในหัวข้อ 3.5 และเขียน `.env.kamal/<env>/config-baseline/<service>.configuration.json` ของสามบริการ (ค่าธรรมดา + reference ของ secret) แล้วพิสูจน์ด้วย `pnpm config:validate`

**ง. ข้อมูล**

15. Restore PostgreSQL จาก dump ตามหัวข้อ 4.3 (ข้อ 1–2) แล้วตรวจจำนวนตาราง/แถวเทียบ manifest (Production 283 / 410,889)
16. Restore object ของ S3 ทุก version แล้ว reconcile `VersionId` ในฐานข้อมูล (หัวข้อ 4.3 ข้อ 3–4)
17. Restore Redis DB0 (หรือเริ่มว่าง — ข้อมูลใน Redis เป็น queue/ledger/rate limit ที่สร้างใหม่ได้ แต่ turn ของ LINE ที่ค้างจะหาย)
18. รัน `infra/security/post-restore-re-erasure.sh` ด้วยเวลา snapshot เพื่อเคารพคำขอลบข้อมูลที่ทำไปแล้ว

**จ. Release แรก**

19. เขียน `.env.kamal/<env>/target.json` (หัวข้อ 2.1) ด้วย host ใหม่, host key, repository, URL, ARN ของ AgentCore และ key เซ็นใหม่; production ตั้ง `cutoverComplete: true` เมื่อโครงสร้างพร้อมจริงเท่านั้น
20. UAT: `infra/kamal/deploy-uat --profile <p> --prepare --publish-images --uat-smoke-acceptance` (registry ใหม่ต้องใช้ `--publish-images` ก่อน) แล้ว `--apply --prepared-build <run>/build --uat-smoke-acceptance`; ต้องได้ `ACCEPTED_LINE_DEFERRED` ที่เซ็นแล้ว
21. ติดตั้ง alarm: `infra/monitoring/runtime-alarms.sh install <env>` แล้ว `verify`
22. ตรวจ journey บน UAT ด้วยมือ: ล็อกอิน, สมัครผ่าน LINE, ส่งใบเสร็จใน LINE, ซื้อแพ็กด้วย Stripe test mode, อีเมล OTP
23. Production: `infra/kamal/promote-prod --profile <p> --uat-release <run-dir ของ UAT> --mode normal --production-browser-acceptance --apply` (ลายเซ็น UAT อายุไม่เกิน 24 ชั่วโมง)

**ฉ. Edge และการเปิดให้ลูกค้า**

24. DNS บน Cloudflare: record DNS-only ของ origin (`origin`, `ai-origin`, `uat-origin`, `uat-ai-origin`) ชี้ ALB; apex/`uat` แบบ Proxied; `www` CNAME; record ของ Postmark (DKIM, Return-Path) และ SPF
25. Worker: แก้ `ORIGIN` ใน `infra/cloudflare/mangmee-host-proxy.worker.js` และ `mangmee-uat-host-proxy.worker.js` ให้เป็น origin ใหม่ (ไฟล์ใน repo ยังเป็นค่าของ ECS รุ่นเก่า), ทดสอบด้วย `node --test infra/cloudflare/mangmee-host-proxy.worker.spec.mjs`, publish UAT ก่อน production; สร้างกฎ redirect ตามหัวข้อ 1.4 (HTTP→HTTPS, `www`, `official`)
26. ตั้ง webhook ของ LINE ไปที่ `https://<origin>/v1/line/webhook` และกด Verify; ตั้ง webhook ของ Stripe และ Postmark
27. สร้างผู้ดูแลระบบจริง (`apps/api/prisma/add-system-admin.ts` หรือ cutover) ห้ามใช้บัญชี seed บน production
28. เอกสารกฎหมาย: ทำชุดหลักฐานตาม `docs/runbooks/legal-release-evidence-bundle.md` หรือบันทึก owner override อย่างชัดแจ้ง; ทบทวนทะเบียน PDPA ใน `docs/security-evidence/` (ผู้ประมวลผลและการส่งข้ามพรมแดนเปลี่ยนตามบัญชีใหม่)
29. เปิด gate ของลูกค้า: ผู้ดูแลตั้ง PlatformAccess เป็น `OPEN` แล้วทำ acceptance 6 ข้อ (หัวข้อ 2.2) และทดลองคุย LINE AI จริงหนึ่งครั้ง
30. บันทึกทุกอย่างลง `docs/runbooks/cloud-environment-operations.md` เป็น inventory ชุดใหม่ และตัดสินใจเรื่องที่ค้าง: เพิ่ม ECR scan gate ในสาย Kamal, เปิด CI ใหม่และพิสูจน์ workflow กับโค้ดปัจจุบัน, แผนความปลอดภัยที่ยัง PLANNED (หัวข้อ 6.4)

เวลาที่เคยวัด: กู้ UAT แบบเย็น (DB + host) 7 นาที 14 วินาที สำหรับการเปิดเครื่องที่มีอยู่; release UAT ~285–310 วินาที และ production ~340–550 วินาทีเมื่อ image เตรียมไว้แล้ว; การกู้ทั้ง environment จาก backup offline (2026-10-09) ใช้ระดับหลายชั่วโมงและต้องมีเจ้าของอยู่หน้าจอ

---

## 11. ข้อกำหนดเชิงปฏิบัติการ (NFR) ที่เอกสารนี้นิยาม

ใช้ช่วงเลข 800 สำหรับเอกสาร 08

| ID | ชื่อ | เกณฑ์ | หลักฐานในโค้ด/เอกสาร |
|---|---|---|---|
| NFR-801 | Production ใช้ artifact เดียวกับที่ UAT ยอมรับ | promote คัดลอก digest ไม่ rebuild; ลายเซ็น UAT อายุ ≤ 24 ชม. | `infra/kamal/release.py`, `promote-prod` |
| NFR-802 | ทุก release ต้องมีผลที่เซ็นและตรวจได้ | `accepted.json` เซ็นด้วย KMS ต่อ environment | หัวข้อ 2.2 |
| NFR-803 | Process ของ production ต้องมีตัวตนของ deployment | ไม่ boot ถ้าไม่มี `DEPLOY_ENVIRONMENT` และ build id ที่ถูกรูป | `resolveDeploymentIdentity` |
| NFR-804 | Config ของ production ต้องผ่านกฎความปลอดภัย | `validateProductionConfig` ไม่มี error; error ไม่พิมพ์ค่า secret | `packages/config/src/index.ts` |
| NFR-805 | ไม่มี SSH สาธารณะสู่ host | SSM tunnel เท่านั้น; host key เปลี่ยนแล้ว release ล้ม | `infra/kamal/README.md` |
| NFR-806 | การเปิดให้ลูกค้าแยกจากการ deploy | PlatformAccess `OPEN` เป็นขั้นแยกที่ผู้ดูแลทำ | runbook V2 ขั้น E |
| NFR-807 | ความล้มเหลวของ release ไม่ถูก retry อัตโนมัติ | lock และ `active.json` คงอยู่จน reconcile | `infra/kamal/README.md` |
| NFR-808 | Migration เดินหน้าอย่างเดียวและ additive | ไม่มี down-migration; hotfix ปฏิเสธ migration ค้าง | หัวข้อ 4.1 |
| NFR-809 | สำรองข้อมูล production | RDS 35 วัน Multi-AZ + deletion protection; Redis snapshot 35 วัน; S3 versioning | หัวข้อ 4.2 |
| NFR-810 | Log ของ production | JSON, ปิดบังค่าอ่อนไหว, เก็บ 14 วัน, ไม่ log prompt | หัวข้อ 5.2 |
| NFR-811 | การเฝ้าระวัง | alarm ของ log volume, Redis, RDS ส่ง SNS ที่ยืนยันแล้ว | `infra/monitoring/runtime-alarms.sh` |
| NFR-812 | งบ AI ต่อบริษัทถูกจำกัดก่อนเรียก provider | reservation ต่อขั้นภายใต้ lock; การเรียกที่ล้มไม่คิดลูกค้า | ADR 0013 |
| NFR-813 | โมเดล/ภูมิภาคของ AI อยู่ใน allowlist | `APPROVED_AI_*`; global profile ต้องมีเลขอนุมัติ | `validateProductionConfig` |
| NFR-814 | การกระทำกับ cloud ต้องมี MFA ของเจ้าของ | deploy role บังคับ MFA ตั้งแต่ 2026-10-21 | หัวข้อ 6.1 |
| NFR-815 | Image ไม่มีช่องโหว่ HIGH/CRITICAL ที่ไม่ได้ waive | gate ของ ECR fail-closed (เฉพาะสาย CI) | หัวข้อ 6.3 |
| NFR-816 | ไฟล์อัปโหลดถูกสแกน | `CLAMAV_HOST` จำเป็นใน production | config schema, `Dockerfile.api-web` |
| NFR-817 | เป้าเวลา release ของ UAT | 600 วินาที; build ≤ 240 วินาที; หยุดก่อน mutation ถ้าเกิน 360 วินาที | `infra/kamal/README.md` |
| NFR-818 | การเข้าถึงข้อมูล production ต้องตรวจสอบย้อนหลังได้ | T1 อ่าน / T2 เขียนต้องมีคนที่สอง arm; มี transcript | `docs/runbooks/production-support-access.md` |

---

## 12. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

สิ่งต่อไปนี้มีใน `infra/` หรือ `scripts/` แต่ไม่ใช่ส่วนของระบบที่ให้บริการตอนปิด จึงระบุไว้เพียงบรรทัดเดียว:

- `infra/prod-ecs-express/` — สายการ deploy บน ECS Express (แทนด้วย Kamal 2026-09-18)
- `.github/workflows/production-a5*.yml`, `u5-*.yml`, `a5-capacity-uat.yml`, `infra/security/*a5*`, `docs/runbooks/production-a5-u5-promotion-ceremony.md` — ceremony A5/U5 V1 (freeze 2026-08-12)
- `infra/line-official/` — Lambda ของ OA ทางการ (ปลดระวาง 2026-10-07; หน้าที่ย้ายเข้า ERP route)
- `apps/web/Dockerfile.lambda` — image ของ web สำหรับ Lambda Web Adapter (ไม่ได้ใช้)
- `docs/runbooks/ses-email-setup.md`, ตัวแปร `SES_*` — ทางเลือก SES (ใช้ Postmark แทน)
- `docs/runbooks/h-14-private-ingress-cutover-runbook.md` — cutover ของยุค ECS ที่ไม่ได้ทำ
- `scripts/load-smoke.k6.js` — load smoke (ไม่พบผลรันที่บันทึกไว้ใน repo)
- `scripts/halloween-image-origin.ts`, `docs/runbooks/halloween-draw-signing.md` — กิจกรรม Halloween (จบ 2026-10)
- `infra/docker/README.md` ส่วน "Mobile" — แผน Flutter ที่ไม่มีโค้ด
- ตัวแปร `TYPHOON_*`, `OPENAI_*`, `LINE_AI_PUBLIC_LOOKUP_ENABLED`, `CRM_BROADCAST_ENABLED`, `AI_FINAL_MUTATION_ENABLED` — ทางเลือก/ความสามารถที่ปิดอยู่ใน production
