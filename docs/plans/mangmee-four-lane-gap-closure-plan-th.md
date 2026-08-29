# Four-lane Gap Closure Plan — แผนปิดช่องว่างก่อน Coding

สถานะ: **ACTIVE — readiness audit 2026-08-26; integration status updated 2026-08-27**

ขอบเขต: ทุกหัวข้อใน [Master Plan Index](mangmee-master-plan-index-th.md) สาย 1–4; **ไม่ review/ไม่เปลี่ยน P14/P26 หรือการจ่ายเงิน Subscribe**

**Owner scope amendment 2026-08-27:** รอบนี้เน้นเก็บข้อมูล/เอกสารรับ–จ่าย ไม่ต้องกระทบยอด. P15–P17, P18–P20 และ revenue automation ที่พึ่ง matching เป็น **DEFERRED BY OWNER** ทั้ง code/harness/activation ไม่ใช่ release/main gate รอบนี้. Checklist เดิมด้านล่างเก็บไว้สำหรับอนาคต ไม่ใช่คำสั่งเริ่มงาน. คง expense/purchase/sales document flow, permission และ accounting safeguards เดิม; ไม่ลบ code/data หรือเปลี่ยน entitlement. ดู [scope ล่าสุด](mangmee-master-plan-index-th.md) และ [memory](../agent-memory/mangmee-capture-first-scope.md).

หลักฐานฐานงาน:

- เอกสาร index ตรงกับ `origin/develop@1ad0ea6c` แบบ byte-for-byte ณ วันที่ตรวจ
- worktree ปัจจุบันอยู่ `plan@425ce7bd` และเก่ากว่า integration ref; ห้ามใช้การ grep ที่ worktree นี้เพียงอย่างเดียวสรุปว่า PR ที่ merge แล้ว “หาย”
- P27 Phase 1–2 อยู่ใน `origin/develop`; Phase 3 ณ เวลาตรวจอยู่ `codex/ledger-p3-bundle@01587293` และยังไม่อยู่ `origin/develop`
- ผลตรวจและคำสั่ง reproduce อยู่ใน [Four-lane Coding-readiness Audit](mangmee-four-lane-coding-readiness-audit-th.md)
- อัปเดต integration 2026-08-27: P27 Phase 0–6 merged ที่ `8b575285`; OCR governance PR #280 merged ที่
  `086a4549` หลัง CI `33030846368` ผ่าน. ข้อความฐานงานก่อนหน้านี้คือ snapshot ตอน audit ไม่ใช่สถานะปัจจุบัน.
- P9-1c PR #281 merged ที่ `d33f8d2e` หลัง CI `33032595709` ผ่าน; ไม่มี cloud rollout ใน phase นี้.
- P24-2a PR #283 merged ที่ `b98e500f` หลัง CI `33034949214` SUCCESS; scoped E2E16/16 + mobile3/3 + sidebar5/5 + web1125/1125 และ JPEG5 ไฟล์อยู่ใน Git. Partner-copy PR #284 merged ต่อที่ `78057e38` หลัง CI `33035656163` SUCCESS. Full P24 ยัง PARTIAL.
- Capture follow-ups: sales-payment retry PR #285 merged `145924a3` / CI `33036847494` SUCCESS; vendor-bill capture PR #286 merged `21f109d5` / CI `33037405174` SUCCESS; expense-payment/date PR #287 merged `11153296` / CI `33039136161` SUCCESS. Final combined E2E33/33 (6+6+21), zero skipped/flaky, web1139/1139, ชุดตรวจ 128/128 รวม real PostgreSQL 6 เคส และ [ภาพ6ไฟล์/API proof](../evidence/expense-payment-capture-integrity/README.md) ตรวจย้อนกลับได้. [Capture-first audit](../agent-memory/capture-first-progress-audit.md) แยก merged delivery จาก Owner/acceptance gates ที่ยังเปิด.
- P11 Phase 0 merged PR290 ที่ `d8d9808e` หลัง exact-head CI `33040896057` SUCCESS; provider ยัง disabled. Corrected AI PR288 head29a0605b merged ที่ `c6f3d06f` หลัง fresh combined review/checks PASS และ exact-head CI33041868515 SUCCESS; old70033af2 green CI ไม่ใช่ final acceptance และ local/CI ไม่ใช่ live AI/main approval. ดู [delivery checkpoint](../agent-memory/capture-first-delivery-checkpoint.md).
- Docs checkpoint PR291 merged `d8f1a853` / CI33043341836 SUCCESS บน `bd88a14e`; runtime jobs ข้ามตาม docs-only scope. P24-2b PR292 merged `a2d8e793` หลัง CI33043955626 SUCCESS บน exact head `d3a531d6`, scoped local/Chrome และ approved-origin capture33/33 + selector61/61/manual draft-reload ผ่าน; ผลแต่ละรอบเก็บแยก ไม่ใช้33/33 เดิมแทนรอบใหม่.

## กติกาใช้แผนนี้

1. `READY` หมายถึงเริ่ม **phase ที่ระบุ** ได้ ไม่ได้แปลว่าเปิด production ได้.
2. หัวข้อที่มีแผนเฉพาะอยู่แล้วให้แผนเฉพาะเป็น canonical; เอกสารนี้เติมเฉพาะ gap/status/gate และห้ามคัดลอก implementation checklist ไปสองที่.
3. ทุก phase จบด้วย focused test, permission/tenant/audit review, loading/error/forbidden state (เมื่อมี UI), อัปเดต task memory และ evidence ของ ref/run ที่ทดสอบ.
4. ห้ามแตะ cloud จากแผนนี้โดยไม่อ่าน `docs/runbooks/cloud-environment-operations.md`; UAT/Production deploy ต้องใช้ protocol `docs/runbooks/uat-production-v2-deployment.md` และบันทึก run IDs ตาม runbook.
5. ห้ามเปิด feature จาก label ใน docs; activation ต้องอ้าง automated evidence + UAT/customer gate ของรอบนั้น.

## สาย 1 — Ops/Monitoring/Scale

<a id="p9--observability-and-drills"></a>
## P9 — Observability และ Incident Drills

สถานะ: **P9-0/1a/1b/1c/2 MERGED DEVELOP; drill/activation ต้องมี UAT evidence**

Canonical spec/plan: [Production Ops Spec](../specs/production-ops-spec.md), [Production Ops Plan](production-ops-plan.md). เอกสารสองฉบับนี้แข็งแรงด้าน runtime alarm, backup/restore, release และ runbook แต่ยังไม่ผูก marketing/signup funnel และ failure class ของสายใหม่เป็น contract เดียว.

### P9-0 — Signal contract

- ทำ catalog หนึ่งแถวต่อ journey stage: official signup receive/claim/provision, SES delivery, LINE login/link, receipt intake/OCR, AI answer, outbox/worker, sales/expense confirmation.
- ทุกแถวระบุ event/metric source, numerator/denominator, latency clock, success/failure terminal states, owner, alert severity และ runbook link.
- label allowlist ห้ามมี `companyId`, email, taxId, LINE user ID, prompt หรือ document payload; tenant drill ใช้ synthetic correlation id เท่านั้น.
- Funnel rate ไม่มี target จนได้ baseline cohort แรก แต่ missing/duplicate terminal event เป็น test failure ตั้งแต่วันแรก.

### P9-1 — Instrumentation + dashboards

- Reuse structured log/metric helpers และ `infra/monitoring/runtime-alarms.sh`; ไม่เพิ่ม telemetry stack.
- Dashboard อย่างน้อย: signup funnel, login/link outcome, API 5xx+p95, queue age/DEAD, OCR/AI accepted→terminal latency, SES delivery/bounce/complaint, outbox stuck.
- Alarm ทุกตัวต้องมี owner + exact runbook + observable recovery; dashboard-only signal ห้ามถูกเรียกว่า alarm coverage.

#### P9-1c — API p95 dashboard closure

- ใช้ `msg=request` + non-negative `durationMs` เดิมเป็น latency observation หน่วย Milliseconds โดยไม่ใส่ default zero/dimensions
- เพิ่ม widget p95/300s ใน dashboard เดิม; เป็น runtime context ไม่ใช่ SLO และไม่เพิ่ม alarm threshold
- `verify` อ่าน exact metric-filter transformation และ dashboard body; fake-AWS tests ครบ UAT/Production + drift rejection
- ไม่เรียก cloud จริงใน implementation phase; UAT install/traffic/alert evidence ยังเป็น rollout gate แยก

### P9-2 — Failure matrix tests

- Automated/synthetic fault cases: API timeout/5xx, Redis/rate-limit unavailable, queue backlog/DEAD, SES hard bounce/provider outage, LINE invalid signature/provider error, OCR/hosted-AI timeout/fallback, DB/outbox failure, provisioning partial failure.
- พิสูจน์ `detect → alert → diagnose → recover/no-duplicate`; mutation flow ต้องพิสูจน์ idempotency หลัง retry.
- ใช้ CloudWatch Synthetics กับ read-only/customer-like canary เฉพาะเส้นทางที่ไม่สร้างข้อมูลจริง หรือใช้ synthetic tenant ที่ cleanup/audit ได้.

### Verify/exit

- `bash infra/monitoring/runtime-alarms.spec.sh`
- focused unit/contract test ของ event terminality/label redaction
- alarm-to-runbook matrix ไม่มี orphan; synthetic failure อย่างน้อยหนึ่งเคสต่อ severity ผ่านใน UAT

<a id="p25--capacity-gate"></a>
## P25 — Capacity Gate ต่อ Cohort

สถานะ: **EXECUTION-READY WHEN INPUTS EXIST; ไม่ใช่งาน coding ใหม่โดย default**

Canonical: [A5 v2 Spec](../specs/production-a5-v2-spec.md), [A5 v2 Plan](production-a5-v2-plan.md), readiness matrix และ workflows/scripts เดิม.

ก่อน run แต่ละครั้ง Owner/ops ต้องบันทึก: จำนวนผู้ใช้วงถัดไป, concurrent/arrival model, journey mix, payload size, duration, SLO/error budget และ headroom target. ห้ามใช้ “จำนวน users” เดี่ยว ๆ เป็น load model.

ลำดับ: validate workload manifest → dry/read-only probe → mutating UAT capacity run ตาม runbook → validate signed result → เก็บ p50/p95/p99, error, queue age, CPU/memory/task headroom, downstream throttle → capacity decision (`PASS`, `LIMIT_COHORT`, `FIX_AND_RERUN`). ECS autoscaling มี latency จึงต้องวัด headroom ไม่ใช่รอให้ task เต็มก่อน.

Exit: exact workflow run ID/result artifact, workload checksum, target cohort และ residual bottleneck ถูกบันทึก; rerun ก่อนขยายวงทุกครั้ง.

## สาย 2 — AI Brain/Advisor/Knowledge

<a id="brain-real--b1b7"></a>
## Brain-Real B1–B7

สถานะ: **READY ตาม slice ในแผนเดิม; family activation ยังมี evidence gate**

ใช้ [Brain-Real Spec](../specs/mangmee-brain-real-answers-spec.md) และ [Brain-Real Plan](mangmee-brain-real-answers-plan.md) เป็น canonical. เริ่มงาน code/harness ที่ไม่เปลี่ยน behavior ได้ตามแผน แต่ห้ามเปิด family ที่ยังไม่มี golden corpus/reviewer. `expense` golden 30 ตัวอย่างและนิยามคำว่า “รายการ” ต้องมี owner/accountant evidence; hosted baseline ที่ไม่มี traffic จริงห้ามถูกนับว่าผ่าน.

Security gate ของทุก family: prompt-injection, sensitive-information disclosure, cross-tenant/permission, excessive-agency/final-mutation และ fallback/replay. Model output เป็นข้อเสนอ; code/permission-checked tool เป็นผู้ยืนยันข้อมูลและ mutation.

<a id="advisor--conversation"></a>
## Advisor Conversation

สถานะ: **SLICE A READY; knowledge/tax/company-aware slices blocked ตาม decision table เดิม**

ใช้ [Advisor Spec](../specs/line-ai-mangmee-advisor-conversation-spec.md) และ [Advisor Plan](line-ai-mangmee-advisor-conversation-plan.md). Slice A ที่ไม่พึ่ง business decision เดินต่อได้. ห้าม publish official accounting/tax card จนมี named reviewer+SLA; role-grant sync และ group/room policy ต้องปิดก่อน slice ที่เกี่ยวข้อง. Activation ต้องผ่าน terminal replay, Flex→text fallback, 550+ eval ตามแผน, latency/cost และ security corpus.

<a id="p23--knowledge-pack"></a>
## P23 — Knowledge Pack/Web Chat/Retrieval

สถานะ: **P23-0/P23-1 PRODUCT-HELP READY; tax advice publication blocked**

Canonical spec: [Accounting & Tax Knowledge Spec](../specs/mangmee-accounting-tax-knowledge-spec-th.md).

### P23-0 — Source manifest + product-help pack

- สร้าง manifest schema: source URL/owner, retrieved/effective/expires, checksum, language, jurisdiction, capability, reviewer/status/supersedes.
- เริ่มจาก product-help/how-to ที่อ้าง code/spec ของ Mangmee; ไม่มี live-web retrieval และไม่มีคำแนะนำภาษีเฉพาะกรณี.
- Pack publish เป็น immutable version; rollback/supersede ได้; stale/expired pack fail closed หรือบอกว่าไม่ทราบ.

### P23-1 — Retrieval boundary + security

- Retrieval รับ company/user/permission context แต่ index ห้ามปน tenant-private documents เว้นมี ACL filter ที่ทดสอบได้.
- Answer ต้องคืน source/as-of/uncertainty; source text เป็น untrusted data และห้ามออก tool/mutation instruction.
- เพิ่ม corpus จาก OWASP GenAI risks: prompt injection, sensitive disclosure, poisoning, improper output handling, excessive agency, vector/embedding weakness และ unbounded consumption.

### P23-2 — Tax/accounting packs (blocked)

ต้องมี named Accounting/Tax reviewers, first-pack scope, retention/PDPA, source allowlist, review SLA และ signed golden answers ก่อน publish. Web chat ใช้ identity/permission เดียวกับเว็บ; anonymous chat ตอบได้เฉพาะ public product help.

Exit P23-1: manifest validation, stale/supersede test, citation/source lineage, ACL negative test, injection/exfiltration suite และ token/cost bound ผ่าน.

## สาย 3 — Official Signup + Email Claim + LINE Login

<a id="p10--external-signup"></a>
## P10 — External Signup

สถานะ: **P10-0 CORE IMPLEMENTED + LOCAL VERIFIED; OWNER AMENDMENT + OFFER/PAYMENT DIRECTION SPECIFIED; PUBLIC INGRESS BLOCKED BY OWNER §8**

Spec: [External Signup Contract](../specs/mangmee-external-signup-contract-spec-th.md).

### P10-0 — Core state/idempotency

- Additive `CompanySignupRequest`, enum/transitions, payload hash, unique external id, audit/outbox และ repository CAS.
- Pure transition tests รวม same-key same-payload, conflict payload, concurrent retry, recover `EMAIL_FAILED/PROVISIONING_FAILED` และ provision once.
- Provision ผ่าน onboarding application service เดิม; `requestedOfferKey` เป็น attribution only และไม่แตะ Billing/entitlement.

### P10-0A — Offer preview (spec-only; ยังไม่มี UI/payment implementation)

- แสดง `FREE_TRIAL` และ paid 259/599/999/1299 ตาม source of truth [Billing §8](../specs/mangmee-billing-subscription-spec-th.md#billing-offer-catalog).
- เปิดเลือกเฉพาะ `FREE_TRIAL`; paid tiers disabled + “เร็ว ๆ นี้”; server reject paid key ด้วย `offer_not_available` และห้าม fallback เป็น Free.
- Slice นี้เป็น catalog/attribution เท่านั้น: ห้ามสร้าง Billing entitlement, payment attempt, EasySlip call หรือ infer quota/feature ที่ยัง TBD.

### P10-0B — Owner amendment 2026-08-29 (spec-only delta)

- คง P10-0 core ที่มีอยู่ แต่ target flow เพิ่ม optional `businessType/phoneNumber/vatRegistered`, email claim + pending credential hash, `PENDING_REVIEW/REJECTED` และ System Admin approve ครั้งเดียวก่อน provisioning ตาม [External Signup §4](../specs/mangmee-external-signup-contract-spec-th.md#external-signup-owner-amendment).
- email verified เป็น identity key หลัก; taxId ตรวจเมื่อมีและชนแล้ว review; ชื่อบริษัทซ้ำได้. Delta ต้องมี migration/state/idempotency/security tests ใหม่ ห้ามนับหลักฐาน P10-0 เดิมว่า cover แล้ว.
- หน้า claim ห้ามเก็บ plaintext/สร้าง User ก่อน approve; Reject ต้องลบ pending hash. คิว approve/reject + dedupe hints + SLA notification ต้อง audit และ idempotent.

### P10-1 — Signed ingress (blocked)

เริ่มหลัง Owner ยืนยัน website secret model (HMAC vs service JWT) และ claim TTL/resend/revoke; duplicate email/taxId/name policy ตอบแล้วใน External Signup §4C. Route ต้องมี timestamp/nonce, raw-body verification, bounded DTO, fail-closed rate limit, signed status endpoint และ zero-secret response.

Exit: concurrency สร้าง request/company/user/membership อย่างละหนึ่ง; duplicate email/taxId deterministic; no temp password/secret; audit/retry reconstruct ได้.

### P10-2 — Paid activation (planned/disabled; depends on P26)

เริ่มได้ต่อเมื่อ Owner เปิด paid offer และ Billing P26 ผ่าน gate เท่านั้น: System Admin approve paid → สร้าง payment attempt จาก offer snapshot → แสดง K BIZ Thai QR ล็อกยอด → EasySlip v2 verify receiver/amount/duplicate → claim `transRef` ครั้งเดียว → `PAYMENT_VERIFIED` จึง provision. Free path approve แล้ว provision โดยไม่ขึ้นกับ provider. **ไม่มี implementation/config/secret/provider call ในรอบบันทึกแผนนี้.**

<a id="p11--email-delivery--claim"></a>
## P11 — Email Delivery + Claim

สถานะ: **PARTIAL — DISABLED-SAFE FOUNDATION MERGED DEVELOP ผ่าน PR290; CLAIM/LIVE DELIVERY ยัง BLOCKED**

Spec: [Email Delivery/Claim](../specs/mangmee-email-delivery-claim-spec-th.md).

- P11-0: port provider/config/dependency จาก `ec03bc6f` พร้อม explicit frontend WEB_BASE_URL fix merged ที่ `d8d9808e` / PR290 / CI `33040896057` SUCCESS บน `6f85339d`. Root post-fix API5325 passed/5423 total (98 skipped), pretest16/30 (14 skipped), focused50/50, config138/138, typecheck/build, network-denied boot4กรณีและ maintenance checks ผ่าน. Root source review หลัง fix ไม่ใช่การเปลี่ยน conditional Opus verdict ก่อน fix ให้เป็น blanket approval; provider คง disabled และ skipped cases ไม่ใช่ PostgreSQL/live-provider evidence.
- Durable send/claim token/public route ไม่อยู่ใน foundation: ต้องตัดสิน raw-link/key lifecycle ที่ไม่ persist plaintext/หลบ outbox redactor พร้อม TTL/resend/revoke ก่อนสร้าง producer/consumer หรือ claim flow. ไม่ถือว่า outbox/claim concurrency ผ่านจากผล provider test.
- ก่อน live ยังต้อง sender identity/configuration set, delivery/bounce/complaint consumer, suppression policy, System Admin status, CSP/no-store, credential/session/provision contract และ email content deny tests; foundation ไม่เปิด sender/region หรือ email จริง.

Exit foundation ผ่านเฉพาะ disabled-safe slice ตาม PR290. Exit claim: durable retry และ hash-only/single-use/expiry/replay/concurrency ตาม contract ที่อนุมัติ รวมข้อความ public ทั่วไปเดียวกันสำหรับ expired/used/unknown ตาม [P11 plan Phase 2](mangmee-email-delivery-claim-plan-th.md#phase-2--claim-tokenroute-blocked). Exit live: SPF/DKIM/DMARC, inbox, hard-bounce/complaint round-trip และ suppression evidence ใน chosen region/domain. ดู [delivery memory](../agent-memory/p11-email-provider-foundation.md); ไม่เปิด provider จากผล local/CI.

<a id="p12--line-loginlinkqr"></a>
## P12 — LINE Login/Link/QR

สถานะ: **P12-0/P12-1 READY; LIVE LINK/HANDOFF BLOCKED**

Spec: [LINE Login Journey](../specs/mangmee-line-login-link-journey-spec-th.md); แผนเดิม [Web LINE Login](web-line-login-plan.md) ใช้เฉพาะส่วนที่ไม่ขัด spec รวม.

- P12-0: inventory/dry-run canonical identities, classify AUTO_REUSE/BACKFILL/CONFLICT/DENY_REVIEW, masked output, no mutation; แก้ lookup ให้ channel-aware พร้อม migration/shadow test.
- P12-1: external browser OAuth authorization-code + PKCE S256, cryptographic state/nonce, exact callback/returnTo allowlist, backend token verification และ BFF HttpOnly cookie; LIFF surface ใช้ `liff.login()` แล้วเข้า verifier เดียวกัน.
- P12-2: unlinked account flow + single-use link/recovery/unlink; ห้าม match ด้วยชื่อ/email/รูป/เบอร์.
- P12-3: web QR opaque code/intent binding/poll rate/replay; deep-link handoff หลัง Owner ตอบ Q1–Q4.

LINE recovery PR #265 เป็น implementation ที่ยังไม่อยู่ develop และ **NOT READY TO MERGE**: read-only review พบ security 5 จุดกับ one-time contract ที่ขัดกัน; [exact findings](../agent-memory/capture-first-progress-audit.md#pr265--security-hold-unmerged-branch-only). แก้/review ตาม evidence ก่อน port และถามความหมาย one-time โดยไม่อนุมานคำตอบ; historical green CI ไม่ปิด gate นี้. AI PR288 head `29a0605b` รวม root-accepted amount/date fix `86c72e7f`; [fresh combined report](../agent-memory/capture-integration-final.md) NO BLOCKERS, API5327/5425 (skip98), Gateway984/984 + Web1139/1139 (zero skip),3types/45pins และ6 real-class/fake-dependency probes ผ่าน. Exact-head CI `33041868515` SUCCESS และ root merged ที่ `c6f3d06f` เมื่อ 2026-08-27T05:30:29Z; PR264 runtime superseded แล้วโดยไม่ปิด PR เก่าใน audit นี้. Old70033af2/CI33040537029 ไม่อนุมัติผลใหม่ และไม่มีการอ้าง live-provider/main acceptance.

Activation gate: LINE Developers Console ยืนยัน Messaging/Login/LIFF อยู่ Provider ที่ออกแบบรองรับ, conflict inventory = 0 หรือมี disposition, shadow resolves ถูก user, cross-tenant negative, revoke/disabled/no-membership และ rollback ผ่าน.

## สาย 4 — Accounting Growth/Parity

<a id="p27--income-expense-ledger"></a>
## P27 — Income/Expense Ledger

สถานะ: **INTEGRATION MERGED PHASE 0–6 (`8b575285`); LED-FIN-07 / external human / rollout gates ยังเปิด**

ใช้ [P27 Spec](../specs/mangmee-income-expense-ledger-spec-th.md) และ [P27 Plan](mangmee-income-expense-ledger-plan-th.md). Phase 0–6 อยู่ใน `origin/develop` แล้ว; ไม่เขียนหรือ merge phase เดิมซ้ำ. ขั้นต่อไปคือปิด Owner/rollout gates ตาม canonical plan โดยอ้าง integration SHA และหลักฐานจริง ไม่ใช้ PR/branch label อย่างเดียว.

<a id="p28--purchase-to-pay"></a>
## P28 — Purchase-to-Pay + Supplier Credit Note

สถานะ: **BLOCKED BY PRODUCT/ACCOUNTING DECISIONS**

ใช้ [P28 Spec](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) และ [P28 Plan](mangmee-purchase-to-pay-mvp-plan-th.md). ห้ามเริ่ม SupplierCreditNote behavior จน Owner ตอบ §10 ข้อ 2–5: เครดิตเกินยอดค้าง, supplier debit note, release steps และ pilot route/stock. ระหว่างรอทำได้เฉพาะ rerun current-truth tests/read-only prototype; ห้ามเลือก recommended option แทน Owner เพราะกระทบยอดค้างและ approval policy.

<a id="p13--line-multi-company-staff"></a>
## P13 — LINE Multi-company Staff

สถานะ: **BLOCKED BY OWNER SECURITY POLICY**

Spec: [P13](../specs/mangmee-line-multi-company-staff-spec-th.md). เริ่มหลัง P12 canonical migration และ Owner ยืนยันว่า active membership ทุก role สลับได้หรือไม่ รวม notification policy เมื่อมีบริษัทที่สอง. เมื่อปลดล็อกให้เปลี่ยน owner-all guards สองจุดหลัง flag default-off, audit namespace ของ pending intake/media/draft และรัน cross-tenant corpus ก่อน cohort.

<a id="p15p17--revenue-foundationinboxmatching"></a>
## P15–P17 — Revenue Foundation/Inbox/Matching

สถานะ: **DEFERRED BY OWNER 2026-08-27 — ไม่ทำในรอบเก็บข้อมูลรับ/จ่าย**

Spec: [P15–P17](../specs/mangmee-revenue-inbox-matching-spec-th.md).

- P15-0: sanitized golden fixtures + classification enum/state, additive fields, migration/rollback and read-only query; no accounting mutation.
- P15-1: accountant-signed classification matrix + human confirmation/audit.
- P16: inbox UI บน banking hub, one-question flow, P27 source-first action, XLSX/export gaps; permission/loading/error/empty states.
- P17: wire deterministic server scorer, persist `SUGGESTED`, explain top 3, human confirm; exact/partial/over/WHT/refund/ambiguous/duplicate tests.

Owner gate: confirm statement-import-first, pilot source/volume, accountant review rule during beta และ matrix approver. Auto-post remains off until source-specific precision ≥99.5%, false auto-confirm = 0 และ P22 revenue contract exists.

<a id="p18p20--revenue-connectors"></a>
## P18–P20 — Revenue Connectors

สถานะ: **DEFERRED BY OWNER 2026-08-27 — รวม shared harness และ provider adapter**

Spec: [Revenue Connectors Contract](../specs/mangmee-revenue-connectors-contract-spec-th.md). หยุด code/harness/adapter ในรอบนี้. เมื่อ Owner กลับมาเปิด scope จึงประเมิน canonical envelope, verifier/poller ports และ provider-neutral conformance fixture runner ใหม่; adapter ต้องมี provider/pilot และ selection gate §6 ครบ. ห้ามขอ credential, mutate provider หรือ infer settlement semantics จาก provider อื่น.

<a id="p21--tax-workpaper--accountant-review"></a>
## P21 — Tax Workpaper + Accountant Review

สถานะ: **CORE PARTIAL READY; FORM OUTPUT BLOCKED BY CURRENT FIXTURE/EXPERT**

Spec: [P21](../specs/mangmee-tax-workpaper-pp30-spec-th.md).

- P21-0: close Decimal gap, form-source manifest/version/checksum, read-only PP30 register+box reconcile preview, no official-form claim.
- P21-1: selected input/carry-forward/amendment additive schema + immutable snapshot tests.
- P21-2: accountant review queue/reasoned override/closed-period UI.
- P21-3: actual PP30/attachment/PND3/53 mapping/export only after current official forms downloaded, sanitized fixture from named accountant และ signed golden mapping.

Exit: source→TaxEvent→register→box→snapshot checksum trace; filed snapshot immutable; carry chain/reconciliation/WHT gate; UI says “เตรียมข้อมูล” ไม่ใช่ “ยื่นแล้ว”.

<a id="p22--controlled-auto-accounting"></a>
## P22 — Controlled Auto-accounting

สถานะ: **EXPENSE SIDE IMPLEMENTED, LIVE BROWSER/ROLLOUT EVIDENCE REMAINS; REVENUE AUTOMATION DEFERRED BY OWNER**

ใช้ [Expense Auto-post Spec](../specs/expense-ledger-auto-post-spec.md), [Implementation Plan](expense-ledger-auto-post-plan.md) และ task memory เป็น canonical. ไม่เขียน expense engine ซ้ำ; ปิด live authenticated browser journey/rollout evidence ที่ plan ยัง unchecked. Revenue auto-accounting เป็น phase ใหม่หลัง P15–P17 มี source-specific precision evidence และต้องมี spec amendment ระบุ preview/approval/reversal/period-lock/idempotency; ห้าม reuse 99.5% ของ source หนึ่งกับทุก source.

<a id="p24--growthux-full-pass"></a>
## P24 — Growth/UX Full Pass

สถานะ: **PARTIAL — P24-2a/2b MERGED DEVELOP; FULL JOURNEY/PHYSICAL-DEVICE ACCEPTANCE REMAINS**

Spec: [P24](../specs/mangmee-growth-ux-full-pass-spec-th.md).

- P24-0: instrument signup→claim→activated funnel ตาม P9; server-backed checklist derived from facts; campaign attribution bounded/redacted.
- P24-1: role-based ordering + opt-in user/company preference; permissions/entitlements remain authoritative; delete/export tests.
- P24-2: device matrix + F-LED-7 audit ทุก customer page, including P27/P28 surfaces; run automated responsive then real iOS/Android/iPad/desktop evidence.
  - P24-2a **merged develop `b98e500f` / PR #283 / CI `33034949214` SUCCESS**: [shared-shell targets](../specs/mangmee-growth-ux-full-pass-spec-th.md#231-p24-2a--shared-shell-targets-scoped-desktop-visible-correction) เฉพาะสามปุ่ม toggle/bell; 44px + forced-colors focus, คง semantics/guards. Repo E2E16/16, drawer/popover3/3, sidebar5/5, web1125/1125 และ real Chrome JPEG5 ไฟล์ผ่าน; final Opus5 max read-only follow-up **APPROVE** หลังแก้ initial REQUEST CHANGES. Intentional `[desktop-visible]` exception จำกัดสามปุ่ม; ไม่ปิด full P24/physical-device matrix. หลักฐาน/ข้อจำกัดอยู่ใน [task memory](../agent-memory/p24-shared-shell-touch-targets.md).
  - P24-2b [selector44px spec](../specs/p24-scope-selector-targets-spec.md) / [plan](p24-scope-selector-targets-plan.md): **merged `a2d8e793` / PR292 / CI33043955626 SUCCESS บน `d3a531d6`**, 2026-08-27T06:08:41Z. Scoped61/61 E2E, web1140/1140, focused89/89 และ typechecks ผ่าน; root ตรวจ [ภาพเดิม8ไฟล์/Chrome journey + manual draft เพิ่ม1ภาพ](../evidence/p24-scope-selector-targets/README.md). หลัง capture24/33 จาก local-origin mismatch ได้ย้ายเฉพาะ own web ไป allowed3000 โดยไม่แก้ API/CORS guard แล้ว fresh capture33/33 + selector61/61 (2 runs รวม94) และ Chrome draft-save/reload ผ่าน. [หลักฐานแยกรอบ](../agent-memory/capture-first-delivery-checkpoint.md#p24-post-scope-capture-rerun) และ [memory](../agent-memory/p24-scope-selector-targets.md) คงผล red/ข้อจำกัด; full P24/human/device gates ยังเปิด.

P24 ไม่กำหนด/บังคับราคา subscription quota หรือ trial expiry; controlled cohort ใช้ existing allowlist/entitlement. Activation-rate target กำหนดหลัง baseline และไม่ block instrumentation/UX fixes.

## Definition of Done ร่วม

- Spec + plan link เปิดได้, current truth ระบุ ref/date และแยก `merged`, `branch-only`, `UAT-proven`, `production-open`.
- Contract/data/state/permission/tenant/audit/idempotency/failure behavior ชัด; final mutation อยู่ application boundary เดิม.
- Focused automated check ผ่าน; financial/tax/security flows มี negative/replay/concurrency/golden cases ตามความเสี่ยง.
- UI มี loading/empty/error/forbidden/disabled-reason/mobile evidence.
- Rollout flag default-off เมื่อ behavior/security เปลี่ยน; UAT evidence + rollback + owner/customer gate ก่อน production.
- Open owner/provider/external decisions ของ active scope ยังเป็น `BLOCKED` และห้ามผู้ implement เติมคำตอบเอง; งาน `DEFERRED BY OWNER` ไม่ถูกนับเป็น release gate จน Owner เปิด scope ใหม่.
