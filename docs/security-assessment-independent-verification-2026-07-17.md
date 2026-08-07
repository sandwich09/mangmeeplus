# WatchDog-BMS — Independent Security Verification & Red-Team Review

> **Confidential / defensive use only.** เอกสารนี้มีรายละเอียด trust boundary และ attack chain ของ production ควรจำกัดการเข้าถึงเฉพาะทีมที่เกี่ยวข้อง

- **วันที่ตรวจ:** 2026-07-17 (Asia/Bangkok)
- **Commit ที่ตรวจ:** `d5b2f546fff5254ff31a61a2904b6d3a3253b32c`
- **Branch:** `develop`
- **รายงานที่นำมาตรวจทาน:** `docs/security-assessment-redteam-2026-07-17.md` ซึ่งยังเป็น untracked file ณ เวลาตรวจ
- **ขอบเขต:** `apps/web`, `apps/api`, `apps/ai-gateway`, `apps/workers`, `packages/*`, Prisma schema, config, dependencies/lockfile, containers, CI/CD, AWS production metadata, API/web surface, logging/monitoring, AI agents, PDPA/compliance evidence และ production resilience
- **รูปแบบ:** white-box review + local focused tests + sanitized container inspection + read-only AWS metadata + passive HTTP/browser verification
- **สิ่งที่ไม่ได้ทำ:** ไม่แก้โค้ดหรือ config, ไม่อ่าน/แสดงค่า secret, ไม่ brute-force, ไม่ส่ง malicious payload ไป production, ไม่ invoke AgentCore, ไม่สร้าง/แก้/ลบ production data

## 1. Executive verdict

**ข้อสรุป: ไม่ควรอนุมัติ production release รอบถัดไปในสถานะปัจจุบัน (stop-ship / very high production risk)** แม้โครงสร้างพื้นฐานด้าน authorization และ AI tool governance หลายส่วนออกแบบดี แต่มีช่องโหว่ที่รวมกันเป็นเส้นทางยึดบัญชี, ยกระดับสิทธิ์, ทำลายความถูกต้องของบัญชี และข้าม security boundary ของ AI ได้

ไม่พบ finding เดี่ยวที่มีหลักฐานครบพอจะจัดเป็น **Critical** โดยไม่ต้องมีเงื่อนไขเพิ่ม แต่พบ **15 กลุ่ม High-risk release blockers** และอย่างน้อย **18 กลุ่ม Medium-risk weaknesses** หลายข้อเกิดอยู่ใน live production configuration/artifact แล้ว ไม่ใช่เพียงสมมติฐานจากโค้ด

| ระดับ | ผลตรวจอิสระ | ความหมายต่อ production |
|---|---:|---|
| Critical | 0 confirmed | ยังไม่มี unauthenticated, no-interaction path ที่พิสูจน์แล้วว่าควบคุมทั้งระบบได้ทันที |
| High | 15 กลุ่ม | ต้องปิดก่อน release/ขยายผู้ใช้; หลายข้อควรทำ incident-style containment |
| Medium | 18 กลุ่ม | ต้องมี owner และกำหนดเวลาปิดที่ตรวจสอบได้ |
| Low / Info | หลายข้อ | defense-in-depth และ operational maturity |
| Unknown | 5 พื้นที่ | ECR scan findings, S3 controls, CloudTrail configuration, live IAM simulation และ log metric filters ถูก IAM ปฏิเสธ |

### 1.1 สิ่งที่รายงาน Opus 4.8 ทำได้ดี

- ยืนยัน H1/H2/H3, M1–M5 และ weakness ด้าน rate limiting ได้ถูกทิศทางเป็นส่วนใหญ่
- จับ deny-by-default guard, LINE verification, CSRF topology, AI permission re-resolution และ current read-only AI tool surface ได้ถูกต้อง
- แยก AI ที่ถูก prompt-inject ออกจาก conventional web attacker ได้ดี
- อ้างอิง file/line เกือบทุก finding ทำให้ตรวจซ้ำได้

### 1.2 จุดที่ต้องแก้ความเข้าใจจากรายงานเดิม

- ข้อสรุปว่า **“ไม่พบ XSS/SSRF ที่ใช้งานได้จริง” ไม่ถูกต้อง**: พบ reflected LIFF XSS และ blind SSRF ใน workflow webhook
- ข้อสรุปว่า **ทุก financial read/relationship tenant-scoped ไม่ถูกต้อง**: พบ cross-tenant ledger reference, attachment-link integrity gap และ branch ABAC gaps
- ข้อสรุปว่า dev dependency CVEs **ไม่อยู่ใน production runtime artifact ไม่ถูกต้อง**: package เหล่านั้นอยู่จริงใน active image แม้ยังไม่พิสูจน์ HTTP reachability
- AI receipt fabrication chain และ AI trust-score manipulation ในรายงานเดิม **ไม่ใช่ exploit ใน tree ปัจจุบัน**
- PDPA ไม่ได้บังคับให้ทุก AI processing ต้องใช้ consent เสมอ; ต้องกำหนด lawful basis ตาม purpose และให้ DPO/ที่ปรึกษากฎหมายยืนยัน
- Claim ว่า AgentCore secret จะอยู่ใน CloudTrail plaintext **ยังไม่มีหลักฐาน**; แต่การอยู่ใน environment/control-plane response และ CLI process argument ยืนยันแล้ว
- การอ้าง “60 agents” ไม่ใช่ verification evidence และไม่มี manifest/commands/artifacts ให้ตรวจ provenance จึงไม่ควรใช้เพิ่มน้ำหนัก severity

## 2. High-risk release blockers

### H-01 — Employee role-grant escalation (รวม H1 และ H2 เดิม)

- **Severity / confidence:** High / High — CWE-269, CWE-266
- **หลักฐาน:** `create-employee.use-case.ts:61-75`, `employee.controller.ts:46-56`, `update-employee.use-case.ts:31-63`, `packages/contracts/src/access-matrix.ts:200-214`
- **สาเหตุ:** การสร้าง employee กันเพียง `OWNER`/`SYSTEM_ADMIN`; ไม่บังคับว่า role ที่แจกต้องมี privilege ไม่เกินผู้แจก ส่วน update guard มอง sensitive permission แค่กลุ่ม people-management และไม่มี self-escalation rule
- **ผลกระทบ:** ผู้ถือสิทธิ์จัดการพนักงานสามารถสร้าง identity หรือเปลี่ยน role ตนเองเป็น `FINANCE`/`ACCOUNTANT` แล้วเข้าถึง financial mutations ได้
- **วิธีแก้:** บังคับ `privilege(grant) <= privilege(granter)`, ห้าม self-role mutation, ใช้ allowlist ของ role ที่แต่ละ role แจกได้ และใช้ maker-checker/step-up สำหรับ finance/ledger/tax roles

### H-02 — Global chart-of-account poisoning ผ่าน mass assignment

- **Severity / confidence:** High / High — CWE-915, CWE-863
- **หลักฐาน:** `ledger.controller.ts:64-75` รับ `@Body() any`; `account.use-case.ts:72-80` spread input; `prisma-ledger.repository.ts:102-104` spread เข้า Prisma
- **สาเหตุ:** runtime DTO ไม่มี whitelist ที่มีความหมายสำหรับ `any` และ persistence เชื่อ field ที่ไม่อยู่ใน TypeScript contract
- **ผลกระทบ:** `ACCOUNTANT` สามารถเปลี่ยน tenant account ให้มี `companyId=null`, `isSystem=true`, เปลี่ยน code/class/normal balance และทำให้ account กลายเป็น global หรือทำให้ global lookup กำกวม กระทบทุก tenant
- **วิธีแก้:** ใช้ concrete class DTO + `forbidNonWhitelisted`, map field แบบ explicit, ทำ tenant/system fields immutable, เพิ่ม DB constraint และให้ global account เปลี่ยนผ่าน migration/admin-only workflow

### H-03 — Manual journal ยอมรับ cross-tenant account/branch และ caller provenance

- **Severity / confidence:** High / High — CWE-20, CWE-863, CWE-668
- **หลักฐาน:** `journal.use-case.ts:167-225`, `prisma-ledger.repository.ts:182-226`, `schema.prisma:2186-2235`
- **สาเหตุ:** ตรวจเพียง arithmetic balance แต่ไม่ resolve ownership/status ของทุก `accountId`, ไม่บังคับ branch scope และยอมรับ source/tax/report metadata จาก caller
- **ผลกระทบ:** ผู้มีสิทธิ์ post journal ที่รู้ foreign account ID สามารถสร้าง balanced entry ที่มีขาหนึ่งอยู่อีก tenant; report ของ tenant ปัจจุบันอาจตัดขาต่าง tenant ออกและเกิด trial-balance/P&L corruption
- **วิธีแก้:** resolve account server-side ทุก line, บังคับ active/posting/company-or-approved-system account, enforce branch scope ทั้ง create/post, ห้าม caller กำหนด provenance/tax snapshot และใช้ composite tenant foreign keys

### H-04 — “Void” เป็นการเปลี่ยน label ไม่ใช่ reversal

- **Severity / confidence:** High / High — CWE-682, CWE-840
- **หลักฐาน:** payment `payment.use-case.ts:75-98`, `prisma-accounting.repository.ts:422-487`; document `document.use-case.ts:292-315`, `prisma-accounting.repository.ts:382-418`
- **สาเหตุ:** void payment เปลี่ยน payment status แต่ไม่ย้อน allocation/paid/outstanding; void document ตั้ง `postingStatus='reversed'` โดยไม่ย้อน payment allocation หรือ journal
- **ผลกระทบ:** AR, cash, document status และ GL ให้ภาพขัดกัน ผู้มีสิทธิ์สามารถใช้เพื่อซ่อนหนี้/เงินหรือทำให้รายงานผิด
- **วิธีแก้:** ทำ idempotent reversal workflow ใน transaction เดียว, สร้าง reversing journal, reverse allocation/recompute balance และเปลี่ยนเป็น reversed หลังทุก side effect สำเร็จเท่านั้น

### H-05 — Money input validation gaps

- **Severity / confidence:** High / High — CWE-20, CWE-1284
- **หลักฐาน:** plain TypeScript input types ใน money modules และ `payment.use-case.ts:16-46` ส่งต่อ input; repository parse จำนวนโดยไม่มี positive/bound/status validation
- **สาเหตุ:** global `ValidationPipe` ไม่มี runtime metadata ให้ plain `type`; validation กระจายและไม่ครอบ sign, bound, currency/direction/status
- **ผลกระทบ:** negative payment สามารถ corrupt AR/payment/allocation state และ tax/document values บาง path
- **ข้อแก้จากรายงานเดิม:** generated negative journal **ไม่กลายเป็น posted GL ที่ valid** เพราะ ledger balance/negative-line validation ปฏิเสธ; คำว่า NaN/malformed “ผ่านหมด” กว้างเกินจริง
- **วิธีแก้:** class DTO + decimal validator, `>0`, business cap, currency precision, valid target state/direction และ revalidate ที่ use case ก่อน transaction

### H-06 — Reimbursement payment race / double disbursement

- **Severity / confidence:** High / High — CWE-362
- **หลักฐาน:** `reimbursement-finance.use-case.ts:133-218`, `prisma-reimbursement.repository.ts:118-123,171-200`
- **สาเหตุ:** read-validate-create-update ไม่ atomic และไม่มี CAS/advisory lock ที่ครอบทั้ง flow
- **ผลกระทบ:** concurrent requests หรือ partial failure หลัง payment/number creation สามารถสร้างการจ่ายซ้ำหรือ state ที่ replay ได้
- **ข้อแก้จากรายงานเดิม:** ordinary sequential replay หลัง request แรกสำเร็จไม่ใช่เส้นทางหลัก; race/partial failure คือ precondition ที่ถูกต้อง
- **วิธีแก้:** transaction + conditional state claim/CAS + per-request advisory lock + durable idempotency key ที่ไม่ขึ้นกับเวลาจาก caller

### H-07 — Vendor bill ไม่มี maker-checker

- **Severity / confidence:** High / High — CWE-863
- **หลักฐาน:** `vendor-bill.use-case.ts:374-417` และ default finance capability matrix
- **สาเหตุ:** submitter สามารถ approve bill ของตนเอง; create/approve/payment permissions อยู่ใน role เดียวโดย default
- **ผลกระทบ:** finance user สร้างและอนุมัติ payable ปลอมได้โดยไม่มีคนที่สองตรวจ ก่อนเรียก payment แยกอีกครั้ง
- **วิธีแก้:** persist submitter, ห้าม approver คนเดียวกัน, configurable threshold/dual approval และแยก payment release permission

### H-08 — Reflected LIFF XSS นำไปสู่ LINE/WatchDog account takeover

- **Severity / confidence:** High / High — CWE-79
- **หลักฐาน:** employee page `auth.controller.ts:407-447`; customer page `customer-line-register.controller.ts:55-96`
- **สาเหตุ:** query value ถูก `JSON.stringify` แล้วฝังใน inline `<script>`; JSON escaping ไม่ escape closing `</script>` และ CSP อนุญาต `'unsafe-inline'`
- **ผลกระทบ:** crafted LIFF link ที่เหยื่อเปิดสามารถรัน script หลัง LIFF SDK, ขอ LINE ID token และนำ employee token ไปแลก WatchDog session ได้ ขึ้นกับ user interaction และ LINE-linked victim
- **วิธีแก้:** external static script + data attribute/JSON script ที่ safe, escape `<` เป็น `\u003c`, nonce/hash CSP ที่ไม่มี unsafe-inline และ validate format/length ของ token/channel IDs

### H-09 — LINE link bearer token ถูกส่งให้ third party และ token claim มี TOCTOU

- **Severity / confidence:** High / High — CWE-200, CWE-522, CWE-362
- **หลักฐาน:** `employee-access.logic.ts:65-91`; `complete-employee-line-link.use-case.ts:22-88`; web แสดง `qrImageUrl` ที่ `EmployeeAccessPages.tsx:187-193`
- **สาเหตุ:** full bearer URL อยู่ใน query ของ `api.qrserver.com`; owner token อายุ 72 ชั่วโมง และ identity-link side effect เกิดก่อน CAS mark-used
- **ผลกระทบ:** QR provider/CDN/log holder อาจ bind LINE identity ของตนกับ OWNER/employee; concurrent distinct LINE identities อาจเกิด side effect ก่อน loser พบว่า token ถูกใช้
- **วิธีแก้:** generate QR locally/same-origin, ลด TTL, claim token atomically ก่อน link ใน transaction/lease, enforce intended LINE identity cardinality และ compensate failed claims

### H-10 — Employee password เป็นวันเกิดและไม่หมดอายุ

- **Severity / confidence:** High / High — CWE-521
- **หลักฐาน:** `employee-access.logic.ts:45-49`; `create-employee.use-case.ts:93-110,196-204`
- **สาเหตุ:** password = `DDMMYYYY`, credential `ACTIVE`, `mustChangePassword=false`, `expiresAt=null`
- **ผลกระทบ:** ผู้รู้วันเกิดหรือข้อมูลบุคคลสามารถเดารหัสได้; ไม่ใช่ temporary password แม้ UX จะสื่อเช่นนั้น
- **วิธีแก้:** invitation/high-entropy one-time secret, temporary state, short expiry, forced setup/change และ MFA/step-up

### H-11 — Upload size/checksum bypass และ post-review evidence overwrite

- **Severity / confidence:** High / High — CWE-367, CWE-345, CWE-400
- **หลักฐาน:** `s3-storage.adapter.ts:37-47`; `complete-attachment-upload.use-case.ts:38-58`; `expense-status.logic.ts:20-57`
- **สาเหตุ:** presigned PUT bind แค่ Content-Type และ reuse ได้ถึงหนึ่งชั่วโมง; completion เชื่อ client checksum/size บางส่วน; expense checksum hash attachment ID ไม่ hash bytes
- **ผลกระทบ:** oversized/pending-object DoS, เปลี่ยน object หลัง review ภายใน URL lifetime และทำให้ tax/expense evidence ไม่ตรงกับ checksum ที่อนุมัติ
- **วิธีแก้:** content-length-range/provider checksum, HEAD metadata verification, immutable/versioned final keys, short single-purpose URL, quarantine/cleanup/quota และ checksum จาก bytes ที่ server/provider ยืนยัน

### H-12 — Privileged bootstrap account ถูก reset ทุกครั้งที่ API start

- **Severity / confidence:** High / High; **confirmed live** — CWE-798/CWE-522
- **หลักฐาน:** `start-production.sh:10`, `start-combined-production.sh:8-10`; `reset-system-admin-password.ts:13-95`; live service มี secret key `SEED_SYSTEM_ADMIN_PASSWORD` และ rotation ปิด (ไม่ได้อ่านค่า)
- **สาเหตุ:** startup upsert ACTIVE SYSTEM_ADMIN, overwrite password hash, ตั้ง `mustChangePassword=false`, ไม่มี expiry และใช้ username default คงที่
- **ผลกระทบ:** password ที่ admin เปลี่ยนเองถูกย้อนกลับหลัง restart/autoscale/deploy; bootstrap credential กลายเป็น privileged credential ถาวร
- **วิธีแก้:** one-time bootstrap, ลบ boot reset/secret หลังสำเร็จ, rotate + revoke sessions, บังคับ MFA/SSO และแยก break-glass account พร้อม alert

### H-13 — Active production image มี nested `.env`, source และ dev/build tooling

- **Severity / confidence:** High / High; **confirmed in active image**
- **หลักฐาน:** active image มี `/app/apps/api/.env` mode `0644` (ตรวจเฉพาะ path/key name), API source, reset script, `tsx`, Prisma, SWC; `.dockerignore:6-7`; `Dockerfile.api-web:22-47`
- **สาเหตุ:** `.dockerignore` ไม่ครอบ nested `.env`; build `COPY . .` และ runner copy app/node_modules ทั้ง tree; deploy build จาก dirty workstation โดย untracked files ไม่ทำให้ tag dirty
- **ผลกระทบ:** credential/config material และ source/admin tooling อยู่ใน deployed artifact เพิ่ม blast radius ของ image/runtime compromise
- **วิธีแก้:** `**/.env*`, clean CI checkout, explicit allowlist copy, dist + production dependencies only, rebuild/rotate credential ที่เคยอยู่ใน image และ scan final layers

### H-14 — Internal services เปิด PUBLIC และ worker สังเคราะห์ OWNER

- **Severity / confidence:** High / High; **confirmed live** — CWE-668, CWE-441
- **หลักฐาน:** live `api-web`, `ai-gateway`, `workers` ทั้ง 3 ACTIVE/PUBLIC บน public subnets; `deploy.sh:233-253,314-325`; worker internal controllers synthesize privileged context จาก `companyId`
- **สาเหตุ:** internal mesh ใช้ internet-reachable service + static shared secret; workers รับ health traffic ทุก path และ task network egress กว้าง
- **ผลกระทบ:** หาก worker token รั่ว ผู้ถือสามารถใช้ arbitrary tenant ID กับ endpoint ที่สร้าง OWNER context; AI secret รั่วเปิด read tools ภายใต้ actor selector
- **วิธีแก้:** private ingress/service discovery, workload identity/mTLS/SigV4, exact route allowlist, high-entropy rotation และห้าม synthesize user/OWNER จาก path parameter

### H-15 — AI trust boundary ถูกขยายถึง control plane, Secrets Manager, RDS และ Redis

- **Severity / confidence:** High / High (บางส่วน live + บางส่วน static high-confidence)
- **หลักฐาน:** AgentCore live `READY/PUBLIC`; deploy ฝัง raw `AI_GATEWAY_INTERNAL_SECRET` ใน environment (`agentcore-deploy.sh:116-170`); AWS `GetAgentRuntime` response มี environment-variable values; trust policy ไม่มี `SourceAccount`/`SourceArn`; AI ECS ใช้ SG ที่ live RDS/Redis อนุญาต และ static task policy อ่าน `watchdog-bms/production/*` (`deploy.sh:202-218`)
- **สาเหตุ:** shared service secret ไม่ใช้ managed secret reference, IAM/network ไม่แยก AI จาก ERP data plane และ actor delegation ไม่ bind cryptographically
- **ผลกระทบ:** control-plane reader สามารถได้ service secret; AI workload compromise อาจอ่าน production secrets และ connect DB/cache โดยตรง ข้าม permission-checked ERP API ซึ่งขัด architecture rule ของ repo
- **ข้อจำกัด:** live inline-policy read/simulation ถูก IAM ปฏิเสธ จึงยืนยัน live เต็มที่เฉพาะ network path; CloudTrail plaintext parameter claim ยัง unverified
- **วิธีแก้:** AgentCore Identity/Secrets Manager retrieval, จำกัด `GetAgentRuntime`, rotate secret, trust conditions, distinct AI SG ที่ไปไม่ถึง DB/cache, exact secret allowlist และ short-lived signed actor delegation

## 3. Medium findings

| ID | Finding / สาเหตุ | ผลกระทบ | วิธีแก้หลัก |
|---|---|---|---|
| M-01 | Internal AI route ตรวจ shared secret แต่รับ `userId/companyId` เป็น actor selector (`internal-tools.controller.ts:186-227`) | secret/gateway compromise เลือก impersonate active owner/finance identity ได้ | workload identity + signed delegation bind actor/company/tool/audience/expiry |
| M-02 | AI Gateway boot ด้วย `logger:false` และไม่ wire Nest logger/request/exception logging | policy probe, provider failure, prompt abuse และ tool deny/error reconstruct ไม่ได้ | structured redacting logger + durable per-tool audit สำหรับ allow/deny/error |
| M-03 | Autonomous OA reply ให้ model ตัดสิน `needsHuman` เองและไม่มี deterministic outbound policy | prompt/stored-template injection ทำให้ OA ส่ง phishing/false promise | URL/domain/payment/PII rules, high-risk human review, template version/review |
| M-04 | Employee AI grounding ตรวจตัวเลข แต่ไม่ตรวจชื่อ/status/negation (`response-composer.agent.ts`) | fabricated nonnumeric facts ผ่าน guard และทำให้พนักงานตัดสินใจผิด | structured claim validation ผูก JSON path/value; deterministic high-impact cards |
| M-05 | Global model config ไม่ enforce approved list/per-company model; lineage ของ Typhoon → second model ไม่ครบ | ระบุ processor/model/region/DSAR/incident scope ไม่ได้; residency drift | mandatory lineage envelope, region policy, per-company model enforcement และ processor register |
| M-06 | Customer erasure request คืน 202 แต่ไม่มี durable row/queue/task/SLA/status | คำขอหายและไม่มี workflow ปฏิบัติสิทธิ | durable case management + verified erase pipeline + staff notification/status |
| M-07 | PDPA self-service export ตัดที่ 1,000 messages/500 bookings โดยไม่มี total/cursor/truncated flag | export อาจไม่ครบแบบเงียบ | async complete archive หรือ pagination พร้อม totals/truncation |
| M-08 | AI turn เก็บ raw previews/source refs ไม่มี TTL/erasure path ที่พบ | PII/confidential queries อยู่เกินจำเป็นและไม่เข้า lifecycle | data minimization, TTL, pseudonymous reference และรวมใน DSAR/retention |
| M-09 | Workflow webhook validate แค่ initial `https://`; fetch follow redirects | blind SSRF ผ่าน redirect/DNS/private or metadata address | URL resolver policy, IP range deny, DNS pin/recheck, redirect off/validated, egress proxy |
| M-10 | Generic attachment link ตรวจ attachment แต่ไม่ตรวจ target tenant/purpose; retrieval บาง path ไม่มี company filter | cross-tenant metadata/integrity injection เมื่อรู้ IDs | validate both sides + composite tenant FK + purpose/permission enforcement |
| M-11 | Accounting/ledger/banking หลาย path ไม่ใช้ `ctx.scopes.branchIds`; schema มี single-ID FK + unconstrained company fields | branch isolation และ referential tenant integrity ไม่ครบ | central branch-scope query helpers + composite FK/constraint + negative tests |
| M-12 | Rate limits เป็น in-memory ต่อ process/fail-open; XFF topology assumption, unbounded key map, login lockout และ refresh throttle gaps | distributed bypass, memory DoS, targeted user lockout/cost amplification | Redis/sliding window, trusted proxy contract, bounded keys/TTL, account-safe backoff/device risk |
| M-13 | Expense/tax CSV quote delimiter แต่ไม่ neutralize formula prefixes | staff เปิด export แล้ว spreadsheet execute formula | prefix dangerous cells, safe export profile และ tests |
| M-14 | Upload trust claimed MIME; ไม่มี magic-byte/AV/quarantine/SVG sanitization | malware, active content และ parser DoS | sniff + AV/quarantine/CDR, disallow/sanitize SVG, forced download headers |
| M-15 | Production `/login` response ไม่มี CSP, HSTS, frame control, nosniff หรือ Referrer-Policy และเปิด `X-Powered-By` | clickjacking/content-injection hardening ไม่เท่า API; เพิ่ม exploitability ของ web bugs | Next security headers + Cloudflare policy, `poweredByHeader:false`, regression test |
| M-16 | CloudWatch log groups 7/7 ไม่มี explicit retention; alarms 3 ตัวไม่มี notification action | evidence โตไม่จำกัดแต่ security incident ไม่ถูกแจ้ง; ขัด spec 90 วัน | retention/KMS by data class, metric filters, notifications/on-call และ deploy verification |
| M-17 | Redis live ไม่มี TLS/at-rest/auth/snapshot/replica; RDS single-AZ/deletion protection off; secrets 7/7 rotation off | compromise blast radius และ recovery/availability ต่ำ | encrypted/authenticated replicated Redis, tested snapshots; RDS HA/protection; rotation runbooks |
| M-18 | CI/ECR supply chain: action tags mutable (`trufflehog@main`), no top-level permissions, ECR tags mutable/no scan gate, base image/tag/remote ADD unpinned, provenance off | dependency/action/image compromise หรือ vulnerable image deploy ก่อน scan | full-SHA actions, least-privilege permissions, immutable digest + SBOM/signing/attestation + scan gate |

## 4. Low / informational hardening

- Refresh rotation ไม่มี family reuse detection; concurrent refresh ยังเกิด last-write-wins self-DoS
- JWT access/refresh/gateway paths ควร pin algorithm/issuer/audience อย่างสม่ำเสมอ และไม่ยอม token ที่ต้อง revoke แต่ไม่มี `sid`
- worker token comparisons บางจุดไม่ constant-time
- internal secrets/crypto keys มีเพียง non-empty/format checks; ไม่มี known-local denylist/entropy floor ที่สม่ำเสมอ
- financial/auth audit หลาย path เป็น fire-and-forget และไม่อยู่ transaction/outbox ที่ guarantee
- PDPA redaction overwrite audit metadata ทั้งก้อน ทำลาย non-PII forensic evidence แม้การ redact PII จะมีเหตุผล
- AgentCore HTTP runtime สะสม request body จน EOF โดยไม่มี byte cap
- public health endpoint เปิดเผย `db:"ok"` และ web เปิด framework disclosure; เป็น reconnaissance signal ระดับต่ำ
- ไม่พบ bot/anomaly detection ที่ evidence ได้; rate limit อย่างเดียวไม่พอรับ automated/AI-speed probing
- CloudWatch ใช้ service-managed encryption อยู่ จึงไม่ควรเรียกว่า unencrypted; CMK เป็น requirement ตาม data classification/compliance ไม่ใช่ blanket vulnerability

## 5. Review disposition ต่อรายงาน Opus 4.8

| Claim เดิม | Verdict อิสระ | การปรับที่จำเป็น |
|---|---|---|
| H1 employee provisioning escalation | Confirmed | รวมกับ granter-scope/self-escalation model |
| H2 role reassignment escalation | Confirmed | finance/accounting role เป็นตัวอย่างที่พิสูจน์ได้ |
| H3 payment void | Confirmed, broader | document void มี pattern เดียวกัน |
| M1 negative/malformed money | Confirmed with correction | corrupt AR/payment; negative generated journal ถูก ledger reject และ malformed บางแบบ Prisma reject |
| M2 erasure “โกหก” เพราะตอบ 202 | Behavior confirmed, wording rejected | 202 หมายถึง accepted ไม่ใช่ completed; ปัญหาจริงคือไม่มี durable workflow |
| M3 public mesh “plausible” | Confirmed live | 3/3 production services PUBLIC |
| M4 reimbursement replay | Confirmed with narrower precondition | concurrency/partial failure ไม่ใช่ ordinary sequential replay |
| M5 vendor bill pay immediately | Confirmed with wording correction | self-approve จริง แต่ payment เป็นอีก call |
| M6 secret in CloudTrail | Partially confirmed | process/env/control-plane retrievability confirmed; CloudTrail plaintext unverified |
| L3 autonomous OA | Confirmed; raise to Medium | text/channel abuse ไม่ใช่ ERP cross-tenant write |
| L14 consent UNKNOWN must deny | Rejected as legal absolute | consent ไม่ใช่ lawful basis เดียว; gap คือ purpose-specific basis/notice/processors/objection |
| L15 OpenAI = US transfer automatically | Overstated | ต้องตรวจ account region/DPA/data flow จริง |
| I5/I6 AI kill switch | Latent design debt | แก้ก่อนเพิ่ม write tool; current executor ไม่มี receipt write |
| I19 ไม่มี documented backup window | Factually wrong | spec ระบุ backup 35 วัน/log 90 วัน; live RDS 7 วันและ logs indefinite คือ config drift |
| Chain 4 / AI-DA2 receipt fabrication | Refuted for current tree | registry entry ไม่มี executor ใน API `toolMap`, คืน `unsupported_module` |
| AI-DA3 prompt injection ปั่น trust score | Refuted | trust score ใช้ deterministic computation ใน API; model agent ไม่ authorize action นี้ |
| “ไม่มี SQLi/SSRF/XSS” | SQLi supported; SSRF/XSS refuted | ไม่พบ user-controlled SQL/command sink แต่พบ webhook SSRF และ LIFF XSS |
| “ทุก financial read tenant scoped” | Rejected as absolute | sampled core reads ส่วนใหญ่ scoped แต่ cross-tenant references/branch/attachment exceptions มีจริง |
| dev CVEs ไม่อยู่ runtime image | Rejected for artifact presence | อยู่ใน active image; specific HTTP reachability ยัง unproven |
| ไม่มี secret commit | Supported for current git scan | แต่ ignored nested `.env` ถูกบรรจุใน active image |

## 6. Dependency, package และ container assessment

### 6.1 Advisory status ที่ยืนยันแบบ targeted

- Active image มี `@hono/node-server@1.19.11`; vendor advisory ระบุ `<1.19.13` affected โดย repeated-slash `serveStatic` middleware bypass. ไม่พบ app runtime import/route ที่พิสูจน์ exploit นี้ จึงเป็น **present but reachability unproven**, ไม่ใช่ “ไม่มีใน image” [GitHub advisory](https://github.com/honojs/node-server/security/advisories/GHSA-92pp-h63x-v22m)
- Active image มี `file-type@20.5.0` และ `21.3.4`. รุ่น 20.5.0 อยู่ใน affected range ของ CVE-2026-31808 และ CVE-2026-32630; 21.3.4 อยู่หลัง fixed versions 21.3.1/21.3.2. ไม่พบ API runtime import ของ vulnerable copy แต่ build tooling ถูก ship มาด้วย [CVE-2026-31808](https://nvd.nist.gov/vuln/detail/CVE-2026-31808), [CVE-2026-32630](https://nvd.nist.gov/vuln/detail/CVE-2026-32630)
- `pnpm-workspace.yaml` ใช้ placeholder strings ใน `allowBuilds`; project pin `pnpm@9.15.0` จึงไม่ควรนับเป็น effective lifecycle-script policy ตามรูปแบบปัจจุบัน [pnpm settings](https://pnpm.io/settings#allowbuilds)
- lockfile มี integrity entries และไม่พบ git/tarball dependency URL จาก focused scan ถือเป็นจุดดี

### 6.2 ข้อจำกัดของ dependency verdict

ไม่สามารถ rerun `pnpm audit --prod` แบบ independent ได้: sandbox ปิด network และ escalation ไม่ได้รับอนุญาตเพราะ audit จะส่ง private dependency graph ไป registry. ดังนั้นตัวเลข “0 high/critical, 1 prod moderate” จากรายงานเดิม **ไม่ได้รับการรับรองซ้ำ** ในรอบนี้; รายงานนี้ยืนยันเฉพาะ installed versions/advisories ข้างต้น

### 6.3 Container/CI strengths

- runtime ใช้ non-root `node`
- ECR 3 repositories เปิด scan-on-push และ encryption AES256
- current HEAD high-confidence secret regex scan ได้ 0 matches; `.mcp.json` มีเพียง `npx` command ไม่มี secret
- CI มี typecheck, test, audit, secret scan, image build และ config validation jobs

## 7. AI-agent red-team conclusions

### 7.1 สิ่งที่ AI ทำไม่ได้ใน normal path ปัจจุบัน

- Customer AI มี tool allowlist ว่างและไม่มี DB client
- ERP executor re-resolve active membership/permissions/branch scope จาก DB และไม่เชื่อ permission claims ที่ gateway ส่งมา
- current API `toolMap` เป็น read-only; `accounting.capture_receipt_evidence` ยัง `unsupported_module`
- booking ใช้ proposal + explicit confirmation ก่อน commit
- tool plan มี allowlist, sanitizer, dedupe, budget และ source-honesty checks

ดังนั้นยังไม่มีหลักฐานว่า customer prompt injection เพียงอย่างเดียวสามารถ post journal, เคลื่อนเงิน หรืออ่านข้อมูล tenant อื่นได้

### 7.2 AI attack chains ที่สมเหตุผล

1. **Shared-secret compromise → actor impersonation → ERP reads**: service secret + known user/company pair → resolver ให้สิทธิ์จริงของ identity ที่ผู้โจมตีเลือก → selective audit/logging ทำให้สอบสวนยาก
2. **Customer prompt injection → trusted OA phishing**: model-controlled `needsHuman` + no deterministic outbound rule → ส่ง link/claim/คำขอชำระเงินที่แบรนด์ไม่ตั้งใจ ภายใน conversation เดิม
3. **Stored CRM/template injection → employee decision corruption**: raw names/status/templates เข้า prompt → numeric-only grounding ไม่จับ semantic lie
4. **AI workload compromise → bypass ERP boundary**: broad secret IAM + live DB/cache network path → เชื่อม data stores โดยตรงแทน permission-checked tools
5. **OCR cost/PII chain**: public/shared-secret surface → repeated image processing → Typhoon + second model → cost amplification และ processor/region lineage ไม่ครบ

### 7.3 AI-specific fixes before any write tool

- บังคับ mutation classification ซ้ำที่ ERP executor รวม `draft_create`/`evidence_capture`
- actor-bound delegation/workload identity แทน naked `userId/companyId`
- deterministic outbound/semantic grounding guards
- durable per-tool audit + security metrics/rate limits/body caps
- provider/model/region/source lineage และ tenant policy enforcement

## 8. Production infrastructure evidence

| Control | Live evidence | Assessment |
|---|---|---|
| ECS Express ingress | 3/3 ACTIVE/PUBLIC | Fail for internal gateway/workers |
| Subnets/egress | 3/3 public; 4 SGs unrestricted egress | Excessive reachability |
| AI → data stores | RDS 5432 และ Redis 6379 allow shared app SG | Violates API-only AI boundary |
| RDS | private, encrypted, auto minor upgrade; single-AZ, 7-day backup, deletion protection off | Mixed; resilience insufficient |
| Redis | 1 node, no TLS/at-rest/auth/snapshot/replica | High operational/security exposure when app SG compromised |
| Secrets | 7 checked; automatic rotation 0/7 | Rotation governance missing |
| Logs | 7 groups; explicit retention 0/7, customer CMK 0/7 | Retention drift; not “unencrypted” |
| Alarms | 3 rollback alarms; notification actions 0/3 | Security/incident alerting absent |
| ECR | scan-on-push, AES256, mutable tags | Good baseline, no enforcement/immutability |
| AgentCore | READY/PUBLIC; secret key in environment metadata; trust conditions absent | Secret/control-plane and network hardening required |

AWS documents that `GetAgentRuntime` returns an environment-variable string map, so IAM read access to this API is sensitive [AWS API reference](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_GetAgentRuntime.html). AWS also recommends `SourceAccount`/`SourceArn`, least privilege, VPC controls, workload identity, restricted egress and audit correlation [AgentCore security best practices](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html).

## 9. Passive production web/API verification

- `https://mangmeeplus.com/` redirected to `/login`; login UI rendered normally
- `/login` returned 200 but response lacked CSP, HSTS, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options` และ `Referrer-Policy`; it exposed `X-Powered-By: Next.js`
- `/v1/health` returned 200 and API helmet/HSTS/CSP headers; body exposed service/db health
- `/v1/docs` returned 404, consistent with Swagger disabled — positive control
- ไม่มีการ submit login form, ไม่มี credential use และไม่มี active XSS/SSRF/race payload against production

## 10. Logging, monitoring และ forensic readiness

สถานะปัจจุบันไม่เพียงพอสำหรับ production incident investigation:

- AI Gateway operational logger ถูกปิด ทำให้ tool allow/deny/error logs ที่ใช้ Nest `Logger` ไม่ออกใน runtime
- durable ERP tool audit เป็น selective และ per-tool outcome/duration อาจ derive จาก turn-level result ทำให้ inaccurate
- API audit หลาย mutation เป็น fire-and-forget
- log groups ไม่มี retention; spec ระบุ 90 วันแต่ deployment ไม่ apply
- alarms ไม่มี notification destination; ไม่พบ evidence ของ auth anomaly, permission probe, prompt abuse, secret access หรือ data-exfil alerts

Minimum closure evidence ควรประกอบด้วย request/tool correlation ID, actor/workload identity, policy decision, model/provider/region, redacted error code, immutable audit outcome, alert owner/on-call และ incident drill

## 11. Compliance and privacy risk

### 11.1 PDPA

Code review ไม่สามารถ certify PDPA compliance และข้อสรุปนี้ไม่ใช่คำปรึกษากฎหมาย. ช่องว่าง evidence ที่สำคัญ:

- ไม่มี ROPA/data inventory ที่ map purpose, data category, lawful basis, processor/subprocessor, region, retention และ transfer mechanism ตาม data flow จริง
- erasure request ไม่มี case/SLA/status; export truncate แบบเงียบ; AI turn/raw preview และ backups ไม่อยู่ใน verified erasure/retention path
- ไม่พบ processor register/DPA/transfer assessment สำหรับ LINE, Typhoon OCR, Bedrock/global inference และ optional OpenAI
- ไม่พบ breach-response owner/runbook/tabletop evidence ที่รองรับ 72-hour notification workflow
- privacy notice/consent model ไม่ควรถูกแก้เป็น opt-in blanket โดยอัตโนมัติ; ต้องกำหนด lawful basis ต่อ purpose และสิทธิ objection/withdrawal

PDPC ระบุ ROPA, consent management, breach notification ภายใน 72 ชั่วโมง และ DSAR management เป็นองค์ประกอบสำคัญของ private-sector compliance [PDPC GPPC Plus](https://register-gppc-plus.pdpc.or.th/). ตัวอย่างนโยบายของ PDPC เองใช้หลาย lawful bases และกล่าวถึง processor/cross-border/retention จึงสนับสนุนข้อโต้แย้งว่า consent ไม่ใช่ฐานเดียว [PDPC privacy policy](https://gppc.pdpc.or.th/privacy-policy/).

### 11.2 Backup/retention correction

รายงานเดิมบอกว่าไม่มี documented backup window ซึ่งไม่ถูกต้อง: `platform-environment-config-spec.md:287-295` ระบุ backup 35 วันและ logs 90 วัน. ปัญหาจริงคือ live RDS 7 วัน, log retention indefinite และไม่มี verified tombstone/re-erasure procedure หลัง restore

### 11.3 SOC 2 / ISO 27001

ไม่พบ evidence เพียงพอสำหรับ claim compliance/certification โดยเฉพาะ access review, change approval, vendor risk, asset/data inventory, incident response, restore drill, vulnerability exception/SLA, security monitoring, key rotation และ control operating evidence. ต้อง audit เอกสารและหลักฐานการปฏิบัติจริงแยกจาก code review

## 12. Defensive attack-chain synthesis

### Chain A — HR privilege → finance role → accounting integrity fraud

Employee create/update gap → finance/accountant role → unvalidated money/chart/journal mutation → broken void/self-approval → รายงานบัญชี/AR/GL ผิดและยากต่อการตรวจย้อนหลัง

### Chain B — LIFF link → LINE identity → WatchDog account takeover

Reflected LIFF XSS **หรือ** bearer QR token disclosed to third party → victim/owner LINE link or ID token → exchange เป็น WatchDog session → ใช้สิทธิ์ของ employee/owner

### Chain C — Public mesh → shared secret → cross-tenant reads

public worker/AI endpoint → secret disclosure/reuse → worker OWNER synthesis หรือ AI actor selector → financial/CRM reads ของ tenant เป้าหมาย → logging/audit gaps ลด detection

### Chain D — AI workload compromise → direct data-plane access

AI runtime/gateway compromise → execution/task role + broad secret scope → DB/cache network path → bypass ERP guards/ABAC/source honesty

### Chain E — Presigned upload → evidence substitution

reusable PUT + client-trusted checksum/size → replace or oversize object → expense/tax review อ้าง attachment ID เดิม → evidence bytes ไม่ตรงกับสิ่งที่อนุมัติ

### Chain F — Persistent bootstrap credential → global administration

seed admin secret compromise → public password login → SYSTEM_ADMIN → tenant/member/integration management; restart ทำให้รหัสที่ตั้งใหม่ถูก reset กลับ

## 13. Prioritized remediation roadmap (recommendation only; not executed)

### P0 — containment / before next release

1. Treat active image and bootstrap admin credential as potentially exposed: remove boot reset, rotate/revoke/rebuild from clean CI, verify no old image/task remains
2. Close LIFF script injection and stop third-party QR token disclosure; make token claim atomic
3. Move workers/AI internal surfaces private; remove AI DB/cache path and broad secret scope; rotate internal secrets
4. Add privilege-grant/self-escalation controls and lock down chart/journal tenant fields
5. Implement true accounting reversals, positive money validation, reimbursement atomicity และ vendor maker-checker
6. Make uploaded evidence immutable and provider-verified

### P1 — next security sprint

1. Wire AI/API structured logging, durable per-tool/mutation audit, retention และ actionable alerts
2. Harden Redis/RDS recovery, encryption/authentication and secret rotation
3. Fix workflow SSRF, attachment target validation, branch ABAC/composite tenant integrity
4. Complete PDPA case/export/retention workflows and processor/transfer records
5. Add deterministic AI outbound/semantic grounding controls and actor-bound delegation

### P2 — continuous hardening

1. Dist-only images, immutable digests, SHA-pinned Actions, SBOM/signing/provenance and vulnerability scan gate
2. Distributed abuse controls, trusted-proxy contract, bot/anomaly detection and account-safe lockout
3. JWT/session/secret entropy hardening, CSV/file-content safety and forensic audit preservation
4. Independent staging penetration test after fixes, followed by restore/incident/tabletop exercises

## 14. Verification evidence

- Focused API security regression: **55/55 passed**
- Focused AI/AgentCore regression: **66/66 passed**
- Typecheck: API, AI Gateway และ Web **passed**
- Isolated semantic-grounding reproduction: fabricated nonnumeric name/status/negation passed current numeric-only guard
- Active image inspection: `.env`, source, reset script และ listed dev/vulnerable packages confirmed; secret values not read
- Live AWS sanitized reads: 3 ECS services, 3 subnets, 4 SGs, 3 ECR repos, 7 log groups, 3 alarms, 1 RDS, 1 Redis, 7 secret metadata records, 1 AgentCore runtime
- Current HEAD high-confidence secret scan: 0 matches; Git history review found only `.env.example`
- Passive production checks: login/health/docs status and response headers only

### Tests passing does not refute the findings

หลาย test ยืนยัน intended happy-path แต่ไม่ได้ทดสอบ adversarial invariant เช่น granter scope, concurrent token claim, cross-tenant account IDs, inline `</script>` boundary, immutable upload bytes หรือ topology จริงของ XFF. ตัวอย่างเช่น rate-limit test เรียก “last XFF hop” ว่า spoof-resistant แต่ production chain Cloudflare → AWS proxy ต้องยืนยัน append/overwrite contract ก่อนจึงจะสรุปได้

## 15. Limitations and unknowns

- ไม่มี active exploitation against production และไม่มี credential/account takeover verification
- ECR image scan findings, S3 bucket metadata, live IAM policy simulation/read, CloudTrail config และ log metric filters ถูก reviewer IAM ปฏิเสธ
- `pnpm audit --prod` ไม่ได้ rerun เพราะ network/data-export restriction
- ไม่มี DAST/full authenticated route crawl ด้วย test tenant และไม่มี mobile/LINE provider-side configuration audit
- ไม่มี legal opinion, external SOC 2/ISO audit, vendor DPA review หรือ disaster-recovery restore drill
- Severity อาจเปลี่ยนเมื่อมีข้อมูล user population, financial limits, WAF/Cloudflare rules, LINE console config และ incident telemetry

## 16. Primary references

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP API Security Top 10](https://owasp.org/API-Security/)
- [AWS AgentCore GetAgentRuntime](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_GetAgentRuntime.html)
- [AWS AgentCore security best practices](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html)
- [AWS global cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html)
- [AWS CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html)
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [Docker build context and `.dockerignore`](https://docs.docker.com/build/concepts/context/)
- [PDPC GPPC Plus](https://register-gppc-plus.pdpc.or.th/)

---

**Final assessment:** รายงาน Opus 4.8 เป็น baseline ที่มีประโยชน์ แต่ให้ความมั่นใจสูงเกินหลักฐานใน injection, tenant isolation, dependency runtime และ AI receipt/trust-score claims ขณะเดียวกันพลาดช่องยึดบัญชี LINE, global ledger poisoning, permanent DOB credentials, upload evidence substitution, persistent system-admin reset และ live AI/data-plane boundary. Production posture จึงเสี่ยงกว่าคะแนนเดิมอย่างมีนัยสำคัญ แม้ยังคงมี security foundations ที่ดีและ current AI write surface ถูกจำกัดไว้จริง
