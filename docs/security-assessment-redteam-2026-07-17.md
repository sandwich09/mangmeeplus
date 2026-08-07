# WatchDog-BMS — Security Assessment & Red-Team Report

- **วันที่:** 2026-07-17
- **ประเภท:** White-box security assessment + Red-Team (owner-authorized, ยังไม่แก้ไขโค้ด)
- **ขอบเขต:** `apps/web`, `apps/api`, `apps/ai-gateway`, `apps/workers`, `packages/*`, `infra/*`, CI/CD, config, dependencies, และ AI agent surface
- **วิธีการ:** ตรวจแบบ multi-agent 14 มุมมอง (auth, authz/tenant-isolation, injection/SSRF, AI-gateway boundary, AI prompt-injection red-team, secrets, dependencies, container/infra/IAM, config hardening, API authz-coverage, logging/audit, PDPA compliance, financial integrity) + adversarial verification ของทุกข้อ + red-team attack-chain synthesis + `pnpm audit` จริง

> หมายเหตุความปลอดภัยของรายงาน: เอกสารนี้เป็น "แผนที่การโจมตี" ของระบบ production — เก็บเป็น private, อย่าเผยแพร่ออกภายนอกทีม

---

## 1. บทสรุปผู้บริหาร (Executive Summary)

โดยรวม WatchDog-BMS มี **security posture ที่แข็งแรงกว่า ERP ทั่วไปในระดับเดียวกันอย่างชัดเจน** โครงสร้างพื้นฐานด้านความปลอดภัยทำมาดี: deny-by-default guard (route ที่ลืมใส่ `@RequirePermissions` จะถูก **ปฏิเสธ** ไม่ใช่เปิด), ABAC + tenant scoping ด้วย `companyId` บนทุก financial read, atomic compare-and-swap (CAS) + advisory lock บน high-value write, double-entry invariant, LINE webhook HMAC verification, LIFF token verification, CSRF double-submit token + `SameSite=Lax` + httpOnly cookies, constant-time secret compare (ส่วนใหญ่), CORS allowlist ที่ fail-closed ใน prod, ไม่มี secret ถูก commit ลง git, และมี trufflehog secret-scan ใน CI

**ไม่พบช่องโหว่ระดับ Critical และไม่พบ injection (SQLi/SSRF/XSS) ที่ใช้งานได้จริง** (Prisma ORM + ValidationPipe ปิดช่องนี้ได้ดี, `@hono/node-server` CVE ถูก verify แล้วว่า **ไม่ reachable** ใน runtime เพราะมาจาก dev-tool ของ Prisma)

ปัญหาที่พบกระจุกอยู่ที่ **3 กลุ่มความเสี่ยงหลัก**:

1. **Insider / privilege escalation → การเคลื่อนย้ายเงิน** — พนักงานสิทธิ์ต่ำที่ทำ HR/provisioning ได้ สามารถ self-grant สิทธิ์ทางการเงินให้ตัวเองได้ (ไม่ต้องเป็น OWNER) แล้วเจอกับ **money-module ที่ไม่ validate จำนวนเงิน** → เกิด fraud ได้
2. **Internal mesh เปิด public + secret แบบ static** — AI gateway / workers ถูก deploy เป็น public ECS service, endpoint `/v1/internal/*` เข้าถึงได้จากอินเทอร์เน็ต โดยกันด้วย shared secret ตัวเดียว บาง endpoint สังเคราะห์ OWNER context จาก `companyId` ใน path
3. **PDPA compliance gaps** — endpoint right-to-erasure ของลูกค้าเป็น no-op (ตอบ 202 แต่ไม่ลบจริง), การลบ PDPA ไปเขียนทับ audit log แบบ destructive, และ AI ประมวลผลข้อความลูกค้าแบบ opt-out (consent UNKNOWN = อนุญาต)

### Scorecard

| ระดับ | จำนวน | สรุป |
|---|---|---|
| 🔴 Critical | 0 | — |
| 🟠 High | 3 | Privilege escalation ×2, silent AR write-off ×1 |
| 🟡 Medium | 6 | Unvalidated money, PDPA erasure no-op, public mesh, TOCTOU, missing SoD, secret-in-CLI |
| 🔵 Low | 15 | Hardening ของ auth/secret/IAM/container/config/logging/compliance |
| ⚪ Info | 19 | Defense-in-depth (alg allowlist, kill-switch, redaction depth, alerting ฯลฯ) |
| **รวม** | **43** | (Dependency: 0 high/critical, 3 moderate ที่ไม่ reachable/dev-only) |

### 5 ความเสี่ยงเร่งด่วนสูงสุดต่อ Production

1. **Insider privilege escalation ผ่าน employee provisioning** (H1+H2) — likelihood **สูง**, ไม่ต้องพึ่งช่องโหว่ infra
2. **Money mutation ไม่ถูก validate** (M1) — global ValidationPipe เป็น no-op สำหรับ money module → จำนวนเงินติดลบ/มั่วเข้าถึง ledger ได้ = payload ที่เปลี่ยนทุก authz gap ให้กลายเป็น financial fraud
3. **Internal mesh เปิด public + static secret + OWNER synthesis** (M3+L12) — cross-tenant breach ถ้า token อ่อนหรือรั่ว
4. **PDPA erasure เป็น no-op ที่ "โกหก" ลูกค้า** (M2) + destructive audit overwrite (I17) + backup ไม่ถูกแตะ (I19) — legal/regulatory exposure ตรง ๆ ภายใต้ PDPA
5. **Autonomous LINE OA ไม่มี deterministic guardrail** (L3) + ประมวลผล consent UNKNOWN โดยอัตโนมัติ (L14) — prompt injection เปลี่ยนช่องทางธุรกิจที่น่าเชื่อถือให้เป็น megaphone ของผู้โจมตี

---

## 2. ช่องโหว่ระดับ HIGH (แก้ก่อน)

### H1 — Privilege escalation ผ่าน employee provisioning (ไม่มี granter-scope check)
- **CWE-269 Improper Privilege Management** · verdict: **CONFIRMED**
- **ที่ตั้ง:** `apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts:61-76`, `apps/api/src/modules/employee-access/presentation/http/employee.controller.ts:46-57`
- **สาเหตุ:** `CreateEmployeeUseCase.execute` ตรวจ `roleIds` แค่กับ `NON_ASSIGNABLE_ROLE_KEYS` (กัน OWNER/SYSTEM_ADMIN) และ **ไม่เคยรับ permission ของผู้เรียกเข้ามาเทียบ** จึงไม่มี separation-of-duties / granter-scope check — role ที่ผูกสิทธิ์ทางการเงินสูง (accounting/ledger/payment) แจกได้อิสระ
- **สถานการณ์โจมตี:** พนักงานที่มีสิทธิ์ `access.employee.create/manage` (พบได้บ่อยในตำแหน่ง office admin) สร้าง employee ใหม่ แนบ role ที่รวมสิทธิ์การเงิน → อ่าน temporary credential ที่คืนกลับมาใน response ตรง ๆ → login เป็น identity ที่มีสิทธิ์การเงิน → เคลื่อนย้ายเงินได้ โดยไม่ต้องเป็น OWNER
- **วิธีแก้:** ก่อน assign role ให้เทียบ permission ของ role ที่จะแจกกับ permission ของผู้เรียก — ห้ามแจกสิ่งที่ผู้เรียกไม่มี (privilege ≤ granter) หรือกำหนด allowlist role ที่ provisioning role แจกได้ และแยก "สร้างพนักงาน" ออกจาก "มอบสิทธิ์การเงิน" เป็นคนละ permission

### H2 — Role reassignment escalation guard ครอบแค่สิทธิ์ people-management ไม่ครอบสิทธิ์การเงิน
- **CWE-269** · verdict: **CONFIRMED**
- **ที่ตั้ง:** `apps/api/src/modules/employee-access/application/use-cases/update-employee.use-case.ts:44-63`, `packages/contracts/src/access-matrix.ts:206-214`
- **สาเหตุ:** `hasPrivilegedGrant` guard เฉพาะ 7 key ด้าน people-management เท่านั้น role ที่ถือสิทธิ์การเงินจึง reassign ได้อิสระ (คู่กับ H1)
- **วิธีแก้:** ขยาย privileged-grant set ให้ครอบสิทธิ์ที่ sensitive ทั้งหมด (การเงิน, tax, ledger, payment, partner-management) หรือใช้กติกา privilege ≤ granter แบบเดียวกับ H1

### H3 — Void accounting payment ไม่ reverse invoice allocation (silent AR write-off)
- **CWE-840 Business Logic Error** · verdict: **CONFIRMED** (จาก financial-integrity deep-dive)
- **ที่ตั้ง:** `apps/api/src/modules/accounting-documents/infrastructure/prisma-accounting.repository.ts:483` (void) เทียบกับ `:448-465` (create side-effect); orchestrate โดย `application/use-cases/payment.use-case.ts:75`
- **สาเหตุ:** `createPayment` อัปเดต invoice (`paidAmount`, `outstandingAmount`, `paymentStatus`) + สร้าง `accountingPaymentAllocation` แต่ `voidPaymentRecord` **แค่ flip status ของ payment row** ไม่ย้อน allocation, ไม่ recompute `outstandingAmount`/`paymentStatus` → void ไม่ใช่ inverse ของ create
- **สถานการณ์โจมตี:** bookkeeper (สิทธิ์ `accounting.payment.create` + `.void` เป็นชุดปกติ) บันทึกรับเงินกับ invoice → invoice เป็น `PAID`, `outstanding=0` แล้ว void payment → เงินสดหายจากระบบแต่ invoice ยัง `PAID` และหายจาก AR aging = primitive สำหรับปกปิดเงินที่ยักไป / เขียนหนี้ทิ้งให้ related party โดยไม่มี approval (และถ้าบันทึกรับเงินซ้ำจะ double-count `paidAmount`)
- **วิธีแก้:** ทำ void ให้เป็น true reversal ใน transaction เดียว — โหลด allocation ของ payment, ลบ `paidAmount` ตาม allocation, recompute `outstandingAmount`/`paymentStatus` ด้วย `calculateOutstandingAmount`/`calculatePaymentStatus`, mark allocation row เป็น cancelled และปฏิเสธการ void payment ที่ post ลง ledger แล้วเว้นแต่จะสร้าง reversing journal ด้วย

---

## 3. ช่องโหว่ระดับ MEDIUM

### M1 — Money-module DTOs เป็น plain `type` → ValidationPipe เป็น no-op → รับจำนวนเงินติดลบ/มั่ว
- **CWE-20 / CWE-1284** · verdict: **CONFIRMED**
- **ที่ตั้ง:** `accounting-payment.controller.ts:13-23`, `application/use-cases/payment.use-case.ts:16-46`, `infrastructure/prisma-accounting.repository.ts:452-454`
- **สาเหตุ:** DTO ของ money module เป็น TypeScript `type` (ไม่ใช่ class + `class-validator`) — global `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` จึงไม่มี metadata ให้ validate และปล่อย body ผ่านทั้งดุ้น (grep พบ **0 decorator** ใน `accounting-documents`, `procurement`, `expenses`, `reimbursements`, `ledger`, `banking`, `tax`) AR-payment path ทำ `parseFloat(input.amount)` ตรง ๆ ไม่เช็ค sign/bound/status/direction → `"-5000"` และ `NaN` ผ่านหมด
- **สถานการณ์โจมตี:** ผู้มีสิทธิ์ `accounting.payment.create` post `amount:"-5000"` → `newPaid` ติดลบ, `outstandingAmount` พอง (หรือ flip invoice ที่จ่ายแล้วกลับเป็นค้าง) และสร้าง negative credit → corrupt AR + downstream ledger/VAT feed; ช่องเดียวกันยอมให้ line ที่ `unitPrice` ติดลบออกใน `TAX_INVOICE` → understate output VAT ใน PP30
- **วิธีแก้:** เพิ่ม class-based DTO + `class-validator` (`@IsPositive`, `@Max`, `@IsIn`) ให้ money module หรือ validate ชัด ๆ ที่ use-case (`amount` เป็น decimal `>0` และ `<=` cap ที่สมเหตุผล, target document status ต้องเป็น issued/payable, `direction` สอดคล้อง `documentType`) และเพิ่ม guard `>0` บน accounting document line amount

### M2 — Customer right-to-erasure endpoint เป็น no-op (ตอบ 202 "recorded" แต่ไม่ลบและไม่แจ้ง staff)
- **PDPA มาตรา 33 (สิทธิให้ลบ)** · verdict: **CONFIRMED**
- **ที่ตั้ง:** `crm-inbox/application/use-cases/crm-pdpa.use-case.ts:179-201`, `presentation/http/crm-customer-pdpa.controller.ts:65-77`
- **สาเหตุ:** `erasure-request` เพียงบันทึก request แล้วคืน 202 — ไม่ trigger การลบจริง และไม่ notify เจ้าหน้าที่ ทำให้ลูกค้าเข้าใจว่าลบแล้วทั้งที่ยังไม่ลบ
- **วิธีแก้:** เชื่อม erasure-request เข้ากับ erasure engine ที่ทำงานจริง (`eraseCustomerData`) หรือสร้าง staff task + SLA ที่ตรวจสอบได้ และคืนสถานะที่ตรงความจริง (received/queued ไม่ใช่ done)

### M3 — AI gateway + workers ถูก deploy เป็น public ECS Express; `/v1/internal/*` เข้าถึงจากอินเทอร์เน็ต กันด้วย static secret เท่านั้น
- **CWE-668 Exposure of Resource to Wrong Sphere** · verdict: **PLAUSIBLE**
- **ที่ตั้ง:** `infra/prod-ecs-express/deploy.sh:237,244-247,314-325,670-701,755-779`
- **สาเหตุ:** service ภายในถูกวางบน public subnet/endpoint; internal-mesh route กันด้วย shared static secret ตัวเดียว (บาง endpoint non-constant-time compare, ไม่มี entropy floor, มี default 64-hex ที่ commit ไว้ใน compose)
- **สถานการณ์โจมตี:** ผสมกับ L12 (worker endpoint สังเคราะห์ OWNER context จาก `:companyId` ใน path) → ถ้า token อ่อน/รั่ว = ดึงข้อมูลข้ามผู้เช่า (financial dashboard, owner summary, inventory) ของ tenant ใดก็ได้
- **วิธีแก้:** ย้าย internal service เข้า private subnet / ปิด public ingress (เข้าผ่าน internal ALB หรือ service-to-service เท่านั้น), บังคับ entropy floor + rotation ของ internal secret, และถ้าเป็นไปได้ใช้ mTLS/SigV4 แทน static shared secret

### M4 — Reimbursement payment recording แบบ non-atomic (TOCTOU double-disbursement)
- **CWE-362 Race Condition** · verdict: **CONFIRMED** (financial-integrity deep-dive)
- **ที่ตั้ง:** `reimbursements/application/use-cases/reimbursement-finance.use-case.ts:133-218`, `infrastructure/prisma-reimbursement.repository.ts:118-124`
- **สาเหตุ:** ลำดับ read→validate→create-payment→update ไม่มี transaction และไม่มี optimistic-concurrency guard (ต่างจาก expense-confirm/vendor-bill ที่ใช้ CAS `updateMany({where:{…,updatedAt}})` + count check) idempotency key ถูก defeat ด้วย try/catch fallback และเลี่ยงได้ด้วยการขยับ `paidAt` 1 วินาที
- **สถานการณ์โจมตี:** finance user (หรือ session ที่ถูก compromise) ยิง record-payment สอง request พร้อมกันบน request `READY_FOR_PAYMENT` → ทั้งคู่อ่าน `outstanding=full`, ผ่าน validate ทั้งคู่, สร้าง payment เต็มจำนวนทั้งคู่ → จ่ายซ้ำ (lost update)
- **วิธีแก้:** ครอบ read-validate-write ใน transaction + conditional `updateMany({where:{id, companyId, status, updatedAt}})` แล้ว assert `count===1` และ/หรือ `pg_advisory_xact_lock` บน request id; เพิ่ม `companyId` ใน where ของ `updateRequest` เป็น defense-in-depth (ใช้ pattern เดียวกับ AR receipt `createPayment` ที่ก็มี lost-update class เดียวกัน)

### M5 — Vendor-bill approval ไม่มี approver ≠ submitter (segregation-of-duties)
- **CWE-863 Incorrect Authorization** · verdict: **CONFIRMED** (financial-integrity deep-dive)
- **ที่ตั้ง:** `procurement/application/use-cases/vendor-bill.use-case.ts:374-390` (submit) และ `:398-417` (approve)
- **สาเหตุ:** maker-checker บังคับใน quotation (`document.use-case.ts:358-363`) และ reimbursement (`reimbursement-approval.use-case.ts:56-66`) แต่ **ไม่บังคับ** ใน vendor bill ซึ่ง authorize จ่ายเงิน supplier ตรง ๆ
- **สถานการณ์โจมตี:** ผู้ถือทั้ง `procurement.vendor_bill.create` และ `.approve` สร้าง vendor bill ไปยังบัญชี supplier ที่ตัวเองคุม → submit → self-approve → payable ทันทีผ่าน `CreateSupplierPaymentUseCase` โดยไม่มีคนที่สองในลูป
- **วิธีแก้:** อ่าน actor จาก `SUBMITTED` approval event (หรือเก็บ `submittedByUserId` บน bill) แล้วปฏิเสธ approve เมื่อ `=== ctx.userId` เว้นแต่มี company policy flag อนุญาต self-approve ชัดเจน (mirror quotation/reimbursement)

### M6 — `AI_GATEWAY_INTERNAL_SECRET` ส่งเป็น plaintext CLI arg ไป AgentCore → รั่วไป CloudTrail / process list
- **CWE-532 / CWE-214** · verdict: **CONFIRMED**
- **ที่ตั้ง:** `infra/ai-gateway/agentcore-deploy.sh:131,157,170`
- **สาเหตุ:** secret ถูกส่งเป็น env/argument ของ CLI ตอน deploy — ปรากฏใน process list ของ host และถูก log ลง CloudTrail (API call parameters)
- **วิธีแก้:** inject ผ่าน Secrets Manager / SSM reference (ไม่ใช่ค่า plaintext บน command line), rotate secret ที่เคยผ่าน CLI, และตรวจสอบ CloudTrail retention ของค่าที่รั่ว

---

## 4. ช่องโหว่ระดับ LOW (15) — hardening

| # | ด้าน | ช่องโหว่ | ที่ตั้ง | สาเหตุ / วิธีแก้ (ย่อ) |
|---|---|---|---|---|
| L1 | auth | Refresh-token rotation ไม่มี reuse/replay detection | `refresh-session.use-case.ts:49-75` | rotate แต่ไม่ตรวจ token เก่าถูกใช้ซ้ำ → แก้: เก็บ family/มาร์ค used, ถ้าเจอ reuse ให้ revoke ทั้ง chain |
| L2 | authz | Controller merge request body ทับ context-derived authz fields (พึ่ง ValidationPipe อย่างเดียว) | `role.controller.ts:41-80` | fragile → แก้: อย่าง spread body, map field ที่ชัดเจนเท่านั้น |
| L3 | ai-redteam | Autonomous customer AI reply ไม่มี deterministic content guardrail | `crm-ai-auto-reply.use-case.ts:164-171`, `crm-customer-reply.agent.ts:38-63` | prompt injection บังคับให้ OA ส่งข้อความที่ผู้โจมตีคุมได้ → แก้: กรอง output ด้วยกติกา deterministic + allowlist template + human review threshold |
| L4 | secrets | (ซ้ำ M6) secret plaintext ไป AgentCore | `agentcore-deploy.sh:131,157,170` | ดู M6 |
| L5 | secrets | ไม่มี entropy floor / known-weak denylist บน prod secret; local crypto key ที่ commit เป็น 64-hex ใช้ prod ได้ | `packages/config/src/index.ts:278-288`, `compose.local.yml:105-107` | แก้: บังคับ min-length/entropy ใน `validateProductionConfig` + denylist ค่า local ที่รู้ |
| L6 | infra | ไม่มี entropy floor บน internal shared secret; ECS deploy ไม่ generate ให้ | `config/src/index.ts:77,79`, `deploy.sh:110-128,463-464` | แก้: generate + บังคับความยาว |
| L7 | infra | Bedrock IAM กว้างเกิน: ทุก region + ทุก Anthropic model ด้วย wildcard (ขัดกับ model allowlist) | `bedrock-invoke-policy.json:13`, `agentcore-execution-role-policy.json:12-13`, `deploy.sh:209` | แก้: จำกัด Resource เป็น model ARN + region ที่ใช้จริง |
| L8 | infra | 64-hex `CREDENTIAL_ENCRYPTION_KEY`/PDPA key ที่ commit เป็นค่า prod ที่ valid ไม่มี reuse detection | `compose.local.yml:105-107` | แก้: mark ค่า local เป็น non-prod + denylist |
| L9 | infra | Prod image ขน node_modules เต็ม (รวม devDeps) บน base ที่ไม่ pin + corepack-fetched pnpm | `apps/api/Dockerfile:2,5,29`, `Dockerfile.api-web:2,5,43` | แก้: pin digest ของ base, `pnpm prune --prod` / multi-stage ทิ้ง devDeps |
| L10 | config | Internal secret ไม่มี min-length/entropy floor; prod fail-fast เช็คแค่ non-empty | `config/src/index.ts:79,176,197,281,326` | แก้: เพิ่ม length/entropy assertion |
| L11 | config | AI Gateway ไม่มี rate limiter และ `RATE_LIMIT_ENABLED` ไม่ถูกบังคับใน prod | `ai-gateway/src/main.ts:22-82`, `config/src/index.ts:165,292` | แก้: เพิ่ม rate-limit guard ให้ gateway + บังคับ enable ใน prod |
| L12 | api-surface | Worker internal endpoint สังเคราะห์ OWNER RequestContext จาก `:companyId` ใน path โดยไม่ตรวจ membership | `dashboard-notifications/.../internal.controller.ts:59-119` | แก้: อย่าสังเคราะห์ OWNER; ผูก context กับ scope ที่ตรวจได้ (คู่กับ M3 = cross-tenant chain) |
| L13 | logging | Audit ของ financial-mutation/auth เป็น fire-and-forget, non-transactional, หายเงียบเมื่อ fail | `ledger/.../journal.use-case.ts:223,258,443`, `issue-token.use-case.ts:66`, `auth.controller.ts:165` | แก้: เขียน audit ใน transaction เดียวกับ mutation หรือ outbox ที่ guarantee |
| L14 | compliance | AI ประมวลผลข้อความลูกค้าโดยไม่มี affirmative consent (opt-out; default `UNKNOWN` = อนุญาต) | `crm-ai-auto-reply.use-case.ts:57-59,93-107`, `schema.prisma:4765,4896` | แก้: เปลี่ยนเป็น opt-in, `UNKNOWN` = ไม่ประมวลผล |
| L15 | compliance | Prod config อนุญาต `MODEL_PROVIDER=openai` → ส่ง customer PII ไป US processor ไม่มี cross-border safeguard | `config/src/index.ts:131-134,329-334` | แก้: บังคับ Bedrock region ใน ap-southeast สำหรับ PII, หรือ block openai ใน prod / DPA + consent |

---

## 5. ช่องโหว่ระดับ INFO (19) — defense-in-depth

| # | ด้าน | รายการ | ที่ตั้ง |
|---|---|---|---|
| I1 | auth | JWT verify ไม่ pin `algorithms` allow-list (กัน alg-confusion) | `watchdog-jwt-verifier.adapter.ts:24`, `dev-jwt-verifier.adapter.ts:26`, `refresh-session.use-case.ts:32` |
| I2 | auth | Refresh-token verify ข้าม issuer/audience (ต่างจาก access-token path) | `refresh-session.use-case.ts:32` |
| I3 | auth | Session-revocation check ถูกข้ามสำหรับ token ที่ไม่มี `sid` claim | `auth.guard.ts:84-92` |
| I4 | auth | Forgot-password มี behavioral/timing side-channel สำหรับ account enumeration | `request-password-reset.use-case.ts:38-71` |
| I5 | ai-boundary | `evidence_capture` tool category เลี่ยง `AI_FINAL_MUTATION` kill-switch ทั้งที่เป็น write | `contracts/src/ai-tools.ts:8,393-397`, `erp-tool.client.ts:29` |
| I6 | ai-boundary | `AI_FINAL_MUTATION_ENABLED` บังคับแค่ใน gateway ไม่ได้บังคับซ้ำใน ERP-core executor | `line-ai/.../internal-tools.controller.ts:186-291`, `tool-policy-enforcer.service.ts:19-23` |
| I7 | ai-boundary | `APPROVED_AI_MODEL_IDS` allow-list ไม่ถูกบังคับตอน inference; per-company model เก็บแต่ไม่ถูกใช้ | `provider.factory.ts:13-26`, `config/src/index.ts:125`, `set-partner-ai-model.use-case.ts:36` |
| I8 | ai-boundary | Gateway JWT verifier ไม่มี `algorithms` allow-list (dead path วันนี้) | `watchdog-context-verifier.ts:21-32` |
| I9 | secrets | Worker token เทียบด้วย `!==` แบบ non-constant-time (timing oracle) | `ai-draft-internal.controller.ts:21` |
| I10 | secrets | pino redaction ครอบแค่ระดับ nesting เดียว (nested secret ไม่ถูก redact) | `logger.service.ts:5-14`, `config/src/index.ts:350-356` |
| I11 | deps | Prod image ขน dev+build dependency ทั้ง tree (ไม่ prune) ดึง package ที่ audit แจ้งเข้า runtime image | `apps/api/Dockerfile:47`, `start-production.sh:4-11` |
| I12 | deps | `file-type` DoS (infinite loop + zip bomb) ผ่าน `@swc/cli` build toolchain (dev-only) | `apps/api/package.json:58`, `pnpm-lock.yaml` |
| I13 | deps | `allowBuilds` ใน `pnpm-workspace.yaml` เป็น block ที่ malformed (ค่า literal "set this to true or false") | `pnpm-workspace.yaml`, `package.json:5` |
| I14 | config | `LOG_LEVEL` ไม่ถูก pin ใน prod และ redaction จำกัดความลึก | `config/src/index.ts:106,240-242`, `logger.service.ts:5-14` |
| I15 | api-surface | Non-constant-time worker-token compare บน internal controller | `dashboard-notifications/.../internal.controller.ts:29,30,91`, `ai-draft-internal.controller.ts:21` |
| I16 | logging | API log redaction พลาด top-level field, internal-mesh secret header, และ customer PII key ทั้งหมด (ต่างจาก gateway) | `api/.../logger.service.ts:5-14` vs `ai-gateway/.../logger.service.ts:5-8` |
| I17 | logging | PDPA erasure เขียนทับ metadata ของ append-only audit log แบบ destructive | `prisma-crm-inbox.repository.ts:2166-2175` |
| I18 | logging | ไม่มี security-event alerting; AI gateway มี request observability บางกว่า | `request-logger.middleware.ts:13-25`, `ai-gateway/src/main.ts`, `api/src/main.ts:102` |
| I19 | compliance | Erasure/retention purge ไม่แตะ DB backup/snapshot — ไม่มี backup-propagation หรือ residual-retention window ที่ documented | `prisma-crm-inbox.repository.ts:1850-2075`, `crm-pdpa.use-case.ts:26-65` |

---

## 6. Red-Team Attack Chains (การร้อยช่องโหว่เป็นการโจมตีจริง)

### Chain 1 — Insider privilege escalation → money movement (surface: API, likelihood: **สูง**)
พนักงานสิทธิ์ provisioning (ไม่ต้อง OWNER) → สร้าง employee + แนบ finance role (H1) เพราะ escalation guard ครอบไม่ถึงสิทธิ์การเงิน (H2) → อ่าน temp credential จาก response → login → POST payment ด้วย amount ติดลบ/มั่ว (M1) → บันทึกจ่ายปลอม/corrupt ledger; audit เป็น fire-and-forget จึงไร้ร่องรอยที่เชื่อถือได้ (L13)
> **Impact:** financial fraud ตรง ๆ + ledger/tax integrity + audit trail ไม่น่าเชื่อถือ

### Chain 2 — Public internal-mesh forge OWNER context → cross-tenant theft (surface: infra, likelihood: กลาง)
ECS API endpoint ที่ reachable จากเน็ต → hit `@Public POST /internal/companies/:companyId/*` (M3) → endpoint สังเคราะห์ OWNER context จาก `companyId` ใน path โดยไม่ตรวจ membership (L12) → กันด้วย static secret ตัวเดียว (non-constant-time + ไม่มี entropy floor + มี default ที่ commit ไว้)
> **Impact:** cross-tenant breach — financial dashboard, owner summary, inventory ของ tenant ใดก็ได้; multi-tenant isolation ถูกทำลายด้วย secret ตัวเดียว

### Chain 3 — LINE prompt injection บังคับ autonomous business OA (surface: AI-agent, likelihood: กลาง)
ข้อความ LINE ขาเข้าไปยัง channel ที่เปิด `autoReplyEnabled` = AUTONOMOUS → prompt injection → agent สร้าง reply ที่ผู้โจมตีคุมเนื้อหา → ส่งออกจาก OA ที่น่าเชื่อถือโดยไม่มี deterministic guardrail (L3) และประมวลผลแม้ consent = UNKNOWN (L14)
> **Impact:** brand abuse, phishing จาก OA ที่ลูกค้าเชื่อถือ, คำพูดเชิงพาณิชย์ที่ผูกพันผิด ๆ, leak catalog/template (webhook มี HMAC verify แล้ว ผู้โจมตีจึงต้องเป็นลูกค้า LINE จริง ซึ่งลด likelihood ลง)

### Chain 4 — AI kill-switch bypass → fabricate tax/receipt evidence (surface: AI-agent, likelihood: ต่ำ)
เรียก AI tool `accounting.capture_receipt_evidence` ผ่าน LINE/AI path ทั้งที่ operator เชื่อว่า write ถูกปิด — `evidence_capture` เลี่ยง `AI_FINAL_MUTATION` (I5) และ kill-switch บังคับแค่ใน gateway ไม่บังคับซ้ำใน ERP core (I6)
> **Impact:** สร้างหลักฐาน tax/receipt ปลอมภายใต้ความเข้าใจผิดว่า write ถูกปิด = tax-fraud + audit-integrity, กัดกร่อน AI safety control หลัก

### Chain 5 — PDPA erasure black hole + destructive audit overwrite (surface: API, likelihood: **สูง**)
ลูกค้า LIFF-authenticated POST `/v1/crm-customer/pdpa/erasure-request` → ระบบตอบ "recorded" แต่ไม่ลบจริง (M2) → staff-side erasure เขียนทับ audit metadata แบบ destructive (I17) → backup ยังเก็บ PII ที่ "ลบแล้ว" (I19)
> **Impact:** PDPA non-compliance ตรง ๆ — right-to-erasure เป็น no-op, audit ถูก rewrite, backup ยังมี PII = legal/regulatory exposure

### Chain 6 — Session-revocation + algorithm-confusion bypass (surface: API, likelihood: ต่ำ)
JWT ที่ไม่มี `sid` claim ข้าม session-revocation check (I3) → session รอด logout/revoke; รวมกับ JWT verify ที่ไม่ pin algorithms (I1/I2) → token acceptance อ่อนลง
> **Impact:** session ที่รอดการ revoke + token acceptance ที่อ่อนลง → persistent account takeover ถ้ามี token-minting/alg-confusion primitive (ปัจจุบันใช้ symmetric secret จึง risk ต่ำ แต่ควร pin)

---

## 7. จุดแข็งด้านความปลอดภัยที่ตรวจสอบแล้ว (Verified Strengths)

**Authorization & tenant isolation**
- `DenyByDefaultGuard` fail-closed: route ที่ไม่มี `@RequirePermissions` ถูก **ปฏิเสธ** (403) ไม่ใช่เปิด
- ทุก financial read เป็น `findFirst({where:{id, companyId}})` — BOLA/IDOR ข้ามบริษัทใช้ไม่ได้ในเส้นทางที่ตรวจ
- `companyId` มาจาก request context ไม่ใช่ body/param

**Financial integrity (แข็งมาก)**
- Double-entry invariant บังคับทุกจุด (`journal-balance.logic.ts:17-60`), ปฏิเสธ negative/imbalance
- ห้ามโพสต์เข้า closed period ทุก entry point; ledger posting re-derive source server-side ไม่เชื่อ client
- Atomic expense confirm (CAS `updatedAt` + `pg_advisory_xact_lock` + immutable source checksum), atomic document issue, atomic vendor-bill approval
- Supplier payment: validate supplier/branch/currency/payable-status match, `amount>0`, `amount≤outstanding` (กัน overpay), idempotency replay guard
- Document numbering race-safe (atomic increment + idempotency + `companyId+branch+type+period` isolation)
- Reimbursement/quotation maker-checker: approver≠submitter + approval snapshot กัน approve-then-edit
- Totals/VAT/WHT compute ฝั่ง server ไม่เชื่อ client

**Auth & session**
- Dev auth backdoor ปิดใน prod (`AuthGuard` รับ dev JWT เฉพาะ `!isProduction`; `/auth/dev/token` และ `local-storage/*` throw NotFound ถ้า `!isLocal`)
- Session revocation (`AuthSession` ACTIVE/expiry/subject check) สำหรับ token ที่มี `sid`
- Password reset/email verification มี rate-limit ต่อ identifier/IP
- CSRF: double-submit token + `SameSite=Lax` + httpOnly + secure (env-gated) cookies

**External input**
- LINE webhook: HMAC-SHA256 + `timingSafeEqual` + length check; per-channel verify **ก่อน** disabled-state 200 (กัน channel-state oracle)
- Customer PDPA/register: ผูกกับ LIFF id token ที่ verify ฝั่ง server ไม่ใช่ client-supplied customerId

**Config & platform**
- CORS allowlist fail-closed (throw ตอน boot ถ้าไม่ตั้งใน prod), `credentials:true` + explicit origin
- Global `ValidationPipe` whitelist+forbidNonWhitelisted (สำหรับ module ที่ใช้ class DTO), TrimStringsPipe
- helmet เปิดใน prod; body limit + upload cap
- ไม่มี secret ใน git; trufflehog secret-scan ใน CI; `internal-secret.ts`/`secret-compare.ts` constant-time (ยกเว้นบาง worker controller — I9/I15)
- **ไม่มี raw SQL** ที่ user ควบคุมได้ → ไม่พบ SQLi; ไม่พบ SSRF/XSS ที่ใช้งานได้

---

## 8. Dependency / Supply-chain Audit (ผลจริงจาก `pnpm audit`)

| ระดับ | prod (`--prod`) | ทั้งหมด |
|---|---|---|
| critical | 0 | 0 |
| high | 0 | 0 |
| moderate | 1 | 3 |
| low | 0 | 0 |

- **`@hono/node-server` GHSA-92pp-h63x-v22m (CVE-2026-39406)** — moderate, มาทาง `@prisma/client → prisma → @prisma/dev → @hono/node-server@1.19.11` เป็น **dev tooling ของ Prisma ไม่ reachable ใน runtime** (verify แล้ว → **REFUTED** ในฐานะ runtime risk) แต่ควร bump เพื่อความสะอาด
- **`file-type` (CVE-2026-31808 infinite loop + CVE-2026-32630 zip bomb)** — moderate ×2, มาทาง `@swc/cli` (dev/build only) ไม่ present ใน prod runtime
- **ข้อสังเกตสำคัญ:** CI gate ใช้ `pnpm audit --prod --audit-level=high` → moderate เหล่านี้ **จะไม่ทำให้ CI fail** พิจารณาลดเป็น `--audit-level=moderate` หรือ track เป็น exception ที่ documented
- `pnpm.overrides` (js-yaml 4.2.0, multer 2.2.0, postcss 8.5.10) เป็นการ pin เชิงความปลอดภัยที่ resolve จริง — ดี

---

## 9. แผนการแก้ไขเรียงลำดับความสำคัญ (Remediation Roadmap)

**P0 — แก้ก่อน deploy รอบถัดไป**
1. H1+H2: ใส่ granter-scope check (privilege ≤ granter) ใน create/update employee — ปิด insider escalation
2. M1: เพิ่ม validation `amount>0`/bound/status ให้ money-module (payment, document line เป็นอย่างน้อย)
3. H3: ทำ void payment ให้เป็น true reversal ใน transaction

**P1 — sprint ถัดไป**
4. M2 + Chain 5: ทำ right-to-erasure ให้ทำงานจริง + เลิก destructive audit overwrite (I17) + documented backup residual-retention (I19)
5. M3 + L12: ย้าย internal service เข้า private subnet + เลิกสังเคราะห์ OWNER จาก path companyId
6. M4 + M5: CAS/transaction ให้ reimbursement payment + approver≠submitter ให้ vendor bill
7. M6/L4: เลิกส่ง secret เป็น plaintext CLI + rotate

**P2 — hardening ต่อเนื่อง**
8. AI safety: I5+I6 (บังคับ kill-switch ซ้ำใน ERP core, ปิดช่อง evidence_capture), I7 (บังคับ model allowlist), L3 (deterministic guardrail), L14 (opt-in consent)
9. Secrets/IAM: L5/L6/L8/L10 (entropy floor + denylist), L7 (จำกัด Bedrock IAM wildcard)
10. Auth hardening: I1/I2/I8 (pin algorithms), I3 (revocation แม้ไม่มี sid), L1 (refresh reuse detection), I4 (timing enumeration)
11. Ops: L11 (gateway rate limit), L9/I11 (prune devDeps + pin base digest), I16/I10/I14 (log redaction depth + PII keys + pin LOG_LEVEL), I18 (security-event alerting), L13 (transactional audit), I9/I15 (constant-time worker token), I13 (แก้ allowBuilds)
12. Dependency: bump `@hono/node-server`/`file-type` chains; ลด CI audit-level เป็น moderate

---

## 10. พื้นที่ที่ควรตรวจเพิ่ม (Follow-up / Coverage Gaps)

- **IDOR/tenant-scoping sweep** ทั่ว accounting/ledger/CRM read+update endpoint — ยืนยันทุก Prisma query ใช้ `companyId` จาก context (ไม่ใช่ body/param) เหมือน `createPayment` (สำคัญขึ้นเพราะ M1 ทำให้ body-supplied id/companyId เป็นความกังวลจริง)
- **SSRF / outbound safety** ใน ai-gateway tool client + provider factory (Bedrock/OpenAI + AgentCore SigV4) — tool argument steer outbound URL ได้ไหม
- **File-upload / OCR pipeline** — type-confusion, reachability ของ file-type CVE ตอน runtime, decompression-bomb DoS บนเอกสารที่ ingest
- **AgentCore SigV4 deploy path** end-to-end + CloudTrail retention ของ secret ที่รั่ว (M6)
- **Runtime reachability** ของ devDependency CVE ที่ shipped (L9/I11/I12) — `tsx`/prisma CLI ตอน container boot ขยาย attack surface จริงไหม
- **Broad Bedrock IAM wildcard** (L7) — gateway ที่ถูก compromise เรียก model/region อื่นเพื่อ cost-abuse/exfil ได้แค่ไหน

---

## 11. Availability / DoS / Rate-limit abuse (addendum — F5 refresh flooding)

ตอบคำถามเฉพาะเรื่อง "F5 รัว / refresh flooding" และเส้นทาง abuse ด้าน availability (ตรวจจากโค้ดจริง `api-rate-limit.guard.ts`, `trusted-client-ip.ts`, `auth-rate-limit.service.ts`, `refresh-session.use-case.ts`, `process-inbound-line-message.use-case.ts`)

### สรุปคำตอบ: F5/refresh flooding **ถูกจำกัดในระดับหนึ่งใน prod แล้ว** แต่ตัว limiter มีจุดอ่อนเชิงออกแบบ

- **API rate limiter บังคับใน prod จริง** — `validateProductionConfig` (`packages/config/src/index.ts:292-293`) fail ถ้า `RATE_LIMIT_ENABLED≠true` และ CI รัน `config:validate` → prod ถูกบังคับ 120 req / 60s ต่อ key (แก้ความเข้าใจจาก L11 ซึ่งพูดถึง **AI Gateway** ที่ยังไม่มี limiter ต่างหาก)
- ดังนั้น **คนมือกด F5 รัว ๆ ไม่ทำให้ระบบล่ม** — โดน 429 ที่ 120/นาที และ `/auth/me` ที่ F5 เรียกซ้ำมี permission cache 60s ช่วยลดโหลด DB

### DA1 — Rate limiter เป็น in-memory ต่อ instance + fail-open + ไม่ใช้ Redis
- **CWE-770** · severity: **Low**
- **ที่ตั้ง:** `api-rate-limit.guard.ts:19,31,58-61`
- **สาเหตุ:** bucket เป็น `Map` ใน memory ของแต่ละ task → ECS หลาย task + canary ทำให้ limit จริง = tasks × 120; task restart รีเซ็ต bucket; ถ้า limiter throw จะ `return true` (fail-open); Redis มีอยู่ (`ioredis`) แต่ไม่ถูกใช้ทำ distributed limit
- **วิธีแก้:** ย้าย rate-limit ไป Redis (sliding window ร่วมทุก instance) หรือใช้ ALB/WAF/Cloudflare rate-limit เป็นชั้นหน้า

### DA2 — Rate-limit key = "last XFF hop" ผิด topology เมื่ออยู่หลัง Cloudflare
- **CWE-348 Use of Less Trusted Source** · severity: **Low–Medium (availability)**
- **ที่ตั้ง:** `trusted-client-ip.ts:4-10` (`hops[hops.length-1]`)
- **สาเหตุ:** mangmee.com = Cloudflare proxy → ALB. ALB ต่อ XFF ด้วย IP ของ peer ที่ต่อตรง = **Cloudflare edge** → key ที่ได้คือ IP ของ Cloudflare edge ไม่ใช่ client จริง ผลคือ (ก) ผู้ใช้จริงหลายคนหลัง edge เดียวกันแชร์ bucket → โดน 429 กันเอง (false positive) และ (ข) ผู้โจมตีที่กระจายผ่านหลาย edge หรือยิงตรง public ECS endpoint (M3) ได้ key คนละตัว → เลี่ยง limit ได้
- **วิธีแก้:** เมื่ออยู่หลัง Cloudflare ให้ key ด้วย `CF-Connecting-IP` (จาก proxy ที่เชื่อถือได้) แทน last-XFF-hop; และปิด public ingress ที่ข้าม Cloudflare (คู่กับ M3)

### DA3 — Targeted login-lockout DoS (ล็อกเหยื่อออกจากระบบด้วยการยิง login ผิด)
- **CWE-645 Overly Restrictive Account Lockout / CWE-307** · severity: **Medium (availability, targeted)** · verdict: **CONFIRMED**
- **ที่ตั้ง:** `auth-rate-limit.service.ts:14-30,82-88`; default `PASSWORD_LOGIN_MAX_PER_IDENTIFIER=5` / `WINDOW=900s` (`config/src/index.ts:87-89`)
- **สาเหตุ:** throttle นับ "failure" ต่อ **identifier** (อีเมล/username) — `assertPasswordLoginAllowed` เช็ค bucket **ก่อน** ตรวจรหัสผ่าน ผู้โจมตีที่รู้อีเมลเหยื่อยิง login ผิด 5 ครั้ง/15 นาที → identifier bucket เต็ม → เหยื่อ login ไม่ได้แม้ใส่รหัสถูก (โดน 429 ก่อนถึงขั้นตรวจ credential) ทำซ้ำได้เรื่อย ๆ
- **สถานการณ์โจมตี:** anonymous internet, รู้แค่อีเมล/username เหยื่อ → ยิง 5 req ทุก 15 นาที → เหยื่อเข้าระบบไม่ได้ถาวร (เป็น availability DoS แบบเจาะจงคน ไม่ใช่ account takeover)
- **วิธีแก้:** เปลี่ยนจาก hard-block ต่อ identifier เป็น **step-up** (CAPTCHA / เพิ่ม delay) หลังเกิน threshold แทนการปฏิเสธ, หรือให้ identifier-throttle เป็น soft signal และให้ IP-throttle เป็นตัวหลัก, หรือ allow success ให้ผ่านแม้ identifier bucket เต็ม (ตรวจ credential ก่อน แล้วค่อย throttle เฉพาะที่ผิดจริง)

### DA4 — Refresh endpoint ไม่มี auth-specific throttle (cost amplification, bounded)
- **CWE-770** · severity: **Low**
- **ที่ตั้ง:** `auth.controller.ts:604` (`session/refresh`, `@Public`, ไม่เรียก `authRateLimit.*`); `refresh-session.use-case.ts:41-84`
- **สาเหตุ:** refresh ทุกครั้ง = JWT verify + `findUnique(authSession)` + `permissionResolver.resolveAccess` (DB) + 2× JWT sign + `update(authSession)` + audit insert; กันด้วย global limiter 120/60s เท่านั้น (ไม่มี throttle เฉพาะ auth) → ผู้ถือ refresh token 1 ใบ loop refresh = amplification เป็น DB write + audit-row growth แต่ **bounded ที่ 120/นาที/key**
- **วิธีแก้:** ใส่ throttle เฉพาะ refresh ต่อ session/sub (เช่นไม่กี่ครั้ง/นาที) เพราะ access token อายุ 900s ไม่มีเหตุให้ refresh ถี่กว่านั้น

### จุดแข็งด้าน availability ที่ยืนยันแล้ว
- **AI cost-DoS ผ่าน LINE ถูกกันดี** — inbound LINE→AI มี atomic per-channel daily cap (`channelCap.tryReserve`, CUST-05) + `PER_CONVERSATION_AUTO_REPLY_DAILY_CAP` + consent gate (`process-inbound-line-message.use-case.ts:761-769`, `crm-ai-auto-reply.use-case.ts:68-75`) → ลูกค้า spam ข้อความไม่สามารถเผา LLM budget เกิน cap ของ channel ได้
- Body limit (default 1mb) + upload cap (10mb) → กัน large-body DoS
- Login throttle นับเฉพาะ failure (success ไม่กิน quota) → ไม่ทำให้ผู้ใช้ปกติโดนล็อกจากการใช้งานจริง (แต่ยังมี DA3)
- **ความเสี่ยง cost-DoS ที่เหลือ:** AI Gateway internal endpoint (OCR/LLM) ไม่มี limiter (L11) — ถ้า internal secret รั่ว/endpoint reachable (M3) จะยิงเผา $ ได้ตรง ๆ

---

## 12. AI-driven attack analysis (addendum — "เอา AI มาวิ่งเจาะระบบ")

แยกเป็น 2 ทิศทาง เพราะ threat model ต่างกันมาก (ตรวจจากโค้ด enforcement จริง: `internal-tools.controller.ts`, `erp-tool.client.ts`, `ai-tools.ts`, `crm-customer-ai/*`, `line-ai-turn.use-case.ts`)

### ทิศทาง A — เจาะ "ผ่าน" AI ของระบบเอง (confused deputy / AI-vs-AI) → **ถูกกันไว้แน่นในปัจจุบัน**

ข้อเท็จจริงเชิงสถาปัตยกรรมที่ยืนยันแล้ว (จุดแข็งสำคัญ):
1. **ไม่มี mutation tool อยู่จริงในระบบ** — `packages/contracts/src/ai-tools.ts` registry มีแค่ `read_summary`×33, `read_detail`×18, `report`×6, `suggestion`×1, `evidence_capture`×1 — **0 ตัวเป็น `final_mutation`/`approval_request`/`draft_create`** → AI ที่ถูก hijack เต็มตัวก็ **ไม่มีเครื่องมือเคลื่อนเงิน/ออกเอกสาร/อนุมัติ/เขียนบัญชี**
2. **ERP core re-resolve สิทธิ์จริงจาก DB ทิ้ง claim ของ caller** — `internal-tools.controller.ts:200-237` (SEC-02/SEC-03): permissions/branchIds/roles/membership/company ที่ caller ส่งมา **ถูกละทิ้งทั้งหมด**, resolve ใหม่จาก `resolveAccess(userId, companyId)`, บังคับ `ai.tool.invoke` + per-tool `hasToolPermissions` → hijack AI ได้แค่สิทธิ์ที่ user จริงมีอยู่แล้ว, ข้ามบริษัทไม่ได้ (resolveAccess ตรวจ membership)
3. **Customer-facing AI ถูก hard-sandbox** — ทุก agent ใน `crm-customer-ai/agents/*` กำกับ boundary: "ALLOWED_TOOLS empty, no LINE_TOOL_REGISTRY / ERP tool client, no DB" + มี separation spec บังคับ → prompt injection จากลูกค้า LINE **เข้าถึง ERP tool/DB ไม่ได้เลย** worst case = มีอิทธิพลต่อ "ข้อความตอบ" (L3) หรือ "field ที่สกัด" (trust-score/booking) เท่านั้น อ่านข้อมูลลูกค้ารายอื่นไม่ได้ (agent ดึงข้อมูลเพิ่มเองไม่ได้ เห็นแค่ context ที่ API ป้อนให้)
4. **Employee LINE AI รันด้วย identity ของพนักงานคนนั้น** (`line-ai-turn.use-case.ts:232-235` `internalUserId`/`companyId`) → hijack ≤ สิทธิ์อ่านที่พนักงานมีอยู่แล้ว, read-only, ไม่ escalate, ไม่ข้าม tenant
5. **Source-honesty enforcement** — `enforceSourceHonesty()` ตรวจ response จาก ERP: non-ok ไม่พก data, ต้องมี `sourceRefs.permissionChecked===true`, reject module/name mismatch → กัน spoofed ERP response ยัด "ข้อเท็จจริงปลอม" เข้า AI

**สรุปทิศทาง A:** AI **ไม่สามารถถูกเปลี่ยนเป็นอาวุธเคลื่อนเงิน/ขโมยข้ามผู้เช่าได้ในตอนนี้** เพราะ read-only + permission re-resolve + customer sandbox

**ความเสี่ยง residual/latent ของทิศทาง A:**
- **AI-DA1 (Medium, latent):** ถ้ามีคน wire tool หมวด `final_mutation`/`approval_request`/`draft_create` ในอนาคต → I6 (kill-switch บังคับแค่ gateway) + I5 (`evidence_capture` classification `allowedWhenFinalMutationDisabled=true`) จะกลายเป็นช่องจริงทันที ควรแก้ I5/I6 **ก่อน**เปิด write tool ตัวแรก
- **AI-DA2 (Low–Med):** `accounting.capture_receipt_evidence` (evidence_capture ตัวเดียวที่มี) รันแม้ kill-switch ปิด (`line-ai-turn.use-case.ts:70,79`) → injected employee AI อาจแนบ/ปลอมหลักฐาน receipt (Chain 4) แต่จำกัดที่ "แนบหลักฐาน" ไม่ใช่ post เอกสาร และยังต้องผ่าน permission re-resolve
- **AI-DA3 (Low):** attacker-customer inject customer-AI เพื่อ **ปั่น trust-score/field ที่สกัดของตัวเอง** (เช่นดันคะแนนความน่าเชื่อถือให้สูง) → ลดแรงเสียดทาน auto-reply/auto-booking → ควรทำ trust-score เป็น advisory ห้าม authorize action ที่ irreversible โดยไม่มีคนตรวจ

### ทิศทาง B — ผู้โจมตีใช้ AI agent เป็น "เครื่องมือ" เจาะ conventional surface → **นี่คือที่ AI เพิ่มความเสี่ยงจริง**

AI ไม่ได้เปิดช่องใหม่ แต่ **automate/scale/adapt** ช่องที่มีอยู่ให้ถูกค้นเจอและ exploit เร็วขึ้นมาก:
- **Fuzz money endpoint (M1):** offensive AI เจอ plain-`type` DTO ที่ไม่ validate + รับ amount ติดลบ ได้ในไม่กี่นาที
- **Enumerate authz combos (H1/H2):** AI ไล่ทดสอบว่า provisioning user แจก role ไหนได้ → เจอ finance-role escalation อย่างเป็นระบบ
- **Adaptive credential/lockout (DA3):** AI orchestrate targeted lockout + credential stuffing หมุน IP เลี่ยง per-IP/identifier limit และ limiter ที่ key อ่อน (DA1/DA2)
- **Automated multi-turn jailbreak ของ OA (L3):** AI iterate injection string จนได้ break ที่ทำให้ OA พ่นข้อความที่ผู้โจมตีคุม — ไม่มี deterministic output guardrail มาหยุด (channel cap จำกัดปริมาณแต่ไม่จำกัดการ breakout)
- **Cost-DoS:** flood AI gateway ที่ไม่มี limiter (L11) ถ้า reachable (M3)

**ช่องว่างการป้องกันที่ AI-attacker ใช้ประโยชน์ (สถานะปัจจุบัน):**
- Bot/automation detection: **ไม่พบ** (ไม่มี CAPTCHA/WAF rule/anomaly detection) → AI probe ได้แทบอิสระ นอกจาก rate limit
- Security-event alerting: **ไม่มี** (I18) → AI-driven probing ไม่ทำให้เกิด alert
- Rate limit มี (API 120/min) แต่ออกแบบอ่อน (DA1-4) → adaptive AI เลี่ยงได้

**สรุปทิศทาง B:** เพราะ server-side invariant แข็ง (CAS, permission re-resolve, tenant scoping, double-entry) AI-attacker ก็ยัง**ทำได้ไม่เกินช่องที่ auth/validation เปิดไว้** ดังนั้น **แก้ M1/H1/H2/DA3 = ปิดประตูที่ AI จะเดินเข้า** และควรเพิ่ม bot-detection + anomaly alerting เป็นชั้น AI-specific

### จุดที่ควรทำเพิ่มเพื่อรับมือ AI-attacker โดยเฉพาะ
1. แก้ I5+I6 **ก่อน** เปิด write tool ตัวแรก (บังคับ kill-switch ซ้ำใน ERP core + จัด evidence_capture เป็น mutation)
2. Deterministic output guardrail + human-in-loop threshold บน autonomous OA reply (L3)
3. Bot/anomaly detection + security-event alerting (I18) — จับ pattern การ probe แบบ machine-speed
4. ทำ trust-score/AI-extracted fields เป็น advisory ห้าม authorize irreversible action เดี่ยว ๆ
5. ปิดช่อง conventional ที่ AI จะ automate: M1 (validate money), H1/H2 (granter-scope), DA3 (login-lockout)

---

*จัดทำโดย automated multi-agent security workflow (60 agents, 14 lenses, adversarial verification) + manual financial-integrity deep-dive + availability/DoS + AI-driven-attack addendum + `pnpm audit` จริง — ทุก finding อ้างอิง file:line ที่อ่านจริง*
