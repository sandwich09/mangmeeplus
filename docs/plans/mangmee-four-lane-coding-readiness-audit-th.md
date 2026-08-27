# Audit ความพร้อม Coding — Master Plan สาย 1–4

วันที่ตรวจ: 2026-08-26 (Asia/Bangkok)

ขอบเขต: [Master Plan Index](mangmee-master-plan-index-th.md) ทุกหัวข้อสาย 1–4; **ไม่ตรวจ P14/P26 และไม่ตัดสินราคา/Subscribe/payment collection**

ผลรวม: **ไม่มีหลักฐานรองรับคำว่า “spec ✅ พร้อม coding” ทั้งก้อนตาม index เดิม**. หลังแก้ครั้งนี้มี phase ที่เริ่มได้อย่างปลอดภัยหลายหัวข้อ แต่ P28, P13, provider adapters P18–P20 และ tax-form activation ยัง block ด้วยคำตัดสิน/หลักฐานภายนอกจริง.

## 1. วิธีตรวจและ baseline

ตรวจแบบไม่เชื่อ status label:

1. เปรียบเทียบเอกสาร index กับ Git refs: ไฟล์ตรงกับ `origin/develop@1ad0ea6c`; worktree ปัจจุบัน `plan@425ce7bd` เก่ากว่า จึงใช้ `origin/develop` เป็น integration baseline และบันทึก branch-only แยก.
2. ตรวจ spec/plan links และอ่าน contract/open questions/acceptance ไม่ดูเฉพาะหัวเอกสาร.
3. ยืนยัน current truth ด้วย `git grep/show` ที่ integration ref และ source จริง: auth/LINE, email DI, Prisma models, banking scorer, procurement, tax, ledger, workflows/scripts/tests.
4. ตรวจ browser แบบ read-only ใน profile ที่ Owner อนุญาต: FlowAccount sales/purchase/expense/bank journeys และ provider API docs ตัวอย่าง; ไม่กดสร้าง/แก้/ส่งข้อมูล และไม่บันทึกชื่อบริษัท, account id, credential หรือข้อมูลส่วนบุคคลลง repo.
5. เทียบกับแหล่งทางการปัจจุบัน: LINE Developers, AWS SES/ECS/CloudWatch, กรมสรรพากร และ OWASP GenAI.

คำสั่ง baseline ที่ reproduce ได้:

```bash
git show -s --format='%h %D %ci %s' HEAD origin/develop origin/main
sha256sum docs/plans/mangmee-master-plan-index-th.md
git show origin/develop:docs/plans/mangmee-master-plan-index-th.md | sha256sum
git grep -n 'line/exchange\|SHOW_LINE_LOGIN\|providerChannelId' origin/develop -- apps packages
git grep -n 'EMAIL_PROVIDER\|SesAuthMailer\|not implemented' origin/develop -- apps packages
git grep -n 'RevenueCategory\|SupplierCreditNote\|scoreMatchCandidate' origin/develop -- apps packages
```

หมายเหตุ ref:

- P27 Phase 1–2 merge อยู่ใน `origin/develop` (`2f9d3c57`, `596776c0` และ merge commits).
- P27 Phase 3 อยู่ `codex/ledger-p3-bundle@01587293` ณ เวลาตรวจ แต่ `git merge-base --is-ancestor 01587293 origin/develop` ยังไม่ผ่าน จึงเป็น **branch-only**, ไม่ใช่ integration-complete.
- Spec 9 ฉบับที่ index อ้างแต่หายจาก worktree ถูก restore จาก `origin/develop` และตรวจ SHA-256 ตรงต้นทางก่อนแก้.

## 2. เกณฑ์ตัดสิน

| Verdict | ความหมาย |
|---|---|
| `READY <phase>` | product boundary, contract, state, security และ focused verification ของ phase นั้นชัดพอเริ่ม coding |
| `PARTIAL READY` | เริ่ม safe/core/read-only phase ได้ แต่ห้ามเปิด behavior/production จน gate ที่ระบุผ่าน |
| `EXECUTION INPUT` | implementation/tooling มีแล้ว; ต้องมี workload/cohort/config จริงก่อนรัน ไม่ใช่งาน coding ใหม่ |
| `IMPLEMENTED / VERIFY` | code merge แล้ว แต่ยังมี UAT/browser/rollout evidence ค้าง |
| `BLOCKED` | การเริ่ม behavior จะเดานโยบาย accounting/security/provider; ต้องรอ Owner/external proof |

หัวข้อหนึ่งจะ `READY` ได้เมื่อมีอย่างน้อย: user journey/rules+exceptions, current truth, architecture boundary, data/state/idempotency, tenant/permission/audit, failure/retry, implementation sequence, focused tests/acceptance และ rollout gate. Tax/security/financial mutation ต้องมี negative/golden/replay evidence ตามความเสี่ยง.

## 3. ผลรายหัวข้อ

### สาย 1 — รับคนให้ไหว

| หัวข้อ | หลักฐานที่พิสูจน์ | ช่องว่างเดิม | Verdict หลังแก้ |
|---|---|---|---|
| P9 Observability | `production-ops-spec/plan`, runtime alarm scripts/spec, production readiness workflows มี monitoring/release/restore foundation จริง | ไม่มี journey/funnel signal contract สำหรับ P10–P12/SES และไม่มี failure-class→alarm→runbook matrix เดียว | `READY P9-0..P9-2`; UAT drill ยัง gate |
| P25 Capacity | A5 spec/plan, capacity workflows, workload manifest/validator และ readiness matrix มีจริง | index ไม่ระบุ cohort N, arrival/concurrency mix, payload, duration, SLO/headroom; label “load จำนวน users” ตรวจซ้ำไม่ได้ | `EXECUTION INPUT`; บันทึก workload ก่อน run |

หลักฐานภายนอกสนับสนุน: AWS ระบุว่า ECS scaling มี latency และควรรักษา headroom/target utilization; CloudWatch Synthetics canary ใช้เดิน customer-like route และส่ง metrics/alarms ได้ — [ECS capacity guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-availability-best-practice.html), [CloudWatch Synthetics](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Synthetics_Canaries.html).

### สาย 2 — สมองมั่งมี

| หัวข้อ | หลักฐานที่พิสูจน์ | ช่องว่าง/สิ่งที่ห้ามเหมารวม | Verdict หลังแก้ |
|---|---|---|---|
| Brain-Real B1–B7 | spec/assessment/catalog/plan และ feature flags/harness/security work มีรายละเอียด; task memory แยก hosted baseline/traffic/golden | ไม่มี traffic จริงบาง baseline; expense golden 30 ตัวอย่าง+นิยาม “รายการ” ยังต้อง owner/accountant; family compile/dormant ≠ production-ready | `PARTIAL READY` ตาม slice; activation block |
| Advisor | spec 827 บรรทัด + plan 509 บรรทัดมี conversation state, terminal replay/fallback/eval/permissions | named Accounting/Tax reviewer+SLA, role-sync, group/room policy และ production eval/latency/cost ยังไม่ครบ | `READY Slice A`; slices อื่น blocked ตาม decision table |
| P23 Knowledge | knowledge spec มี taxonomy/source governance/capability boundary แต่ open decisions 7 ข้อ | ไม่มี implementation plan เดิม, reviewer/first pack/PDPA/live-web/mutation/SLA ไม่ชี้ขาด | `READY P23-0/1` เฉพาะ product-help; tax publish blocked |

Security suite ถูกเพิ่มเป็น gate เพราะ OWASP 2025 ระบุ prompt injection, sensitive disclosure, data poisoning, improper output handling, excessive agency และ vector/embedding weakness เป็น risk แยก — [OWASP Top 10 for LLM/GenAI](https://genai.owasp.org/llm-top-10/).

### สาย 3 — สมัคร/Claim/LINE Login

| หัวข้อ | Code truth | ช่องว่างเดิม | Verdict หลังแก้ |
|---|---|---|---|
| P10 External signup | ไม่มี public signup; internal onboarding admin-only/no email; มี public customer-register, HMAC/timing-safe, DB idempotency และ durable outbox precedent | auth model, claim TTL/resend/revoke, duplicate taxId policy; payload เดิมผูก `requestedPackage` กับ P26 โดยไม่จำเป็น | `READY P10-0`; public ingress blocked |
| P11 Email/claim | config มี `ses` แต่ DI throw ทำให้ API boot ไม่ได้; port ไม่มี SES adapter; outbox ไม่มี EMAIL delivery | sender domain/DNS/region, delivery-event/suppression contract และ live evidence | `CORE READY`; live blocked |
| P12 LINE login/link/QR | `/auth/line/exchange` 403 เสมอ, button hard-code off, use case unreachable; identity unique รวม channel แต่ lookup ไม่กรอง channelและ fallback `unknown` | spec เดิมถาม LIFF หรือ OAuth ทั้งที่เป็นคนละ surface; Provider-console/deep-link decisions/migration proof ยังขาด | `READY P12-0/1`; live link/QR partial blocked |

LINE ทางการยืนยัน web app ใช้ authorization-code flow; `state` ต้อง unique, `nonce` ป้องกัน replay, PKCE รองรับ S256 และภายใน LIFF ควรใช้ `liff.login()`; security checklist บังคับ HTTPS/exact callback/open-redirect guard/state verification/token verification — [web integration](https://developers.line.biz/en/docs/line-login/integrate-line-login/), [security checklist](https://developers.line.biz/en/docs/line-login/security-checklist/). Account linking ทางการใช้ single-use link token และ nonce คาดเดาไม่ได้อย่างน้อย 128 บิต — [LINE account linking](https://developers.line.biz/en/docs/messaging-api/linking-accounts/).

AWS SES แยก sender identity authentication (SPF/DKIM/DMARC) และ configuration sets/event destinations; จึงแก้ P11 ให้ live gate ต้องพิสูจน์ delivery/bounce/complaint ไม่ใช่แค่ send API 2xx — [SES identities](https://docs.aws.amazon.com/en_en/ses/latest/dg/configure-identities.html), [SES configuration sets](https://docs.aws.amazon.com/en_en/ses/latest/dg/using-configuration-sets.html).

### สาย 4 — FlowAccount parity/รายรับ/ภาษี/Growth

| หัวข้อ | Code truth | ช่องว่าง/ความเสี่ยง | Verdict หลังแก้ |
|---|---|---|---|
| P27 Ledger | Phase 1 Decimal/payment number + Phase 2 RevenueCategory merge ใน `origin/develop`; Phase 3 code อยู่ branch | index เดิมบอก “คิวถัดไป” แต่ไม่แยก branch-only/integration; worktree เก่าทำให้ grep สับสน | `IMPLEMENTED 0–2`; review/merge Phase 3 แล้วทำ 4–6 |
| P28 Purchase-to-pay | procurement engine/PO/goods receipt/vendor bill/payment/AP มีจริง; supplier CN model/route/UI ไม่พบ | owner decisions §10 ข้อ 2–5 กระทบ outstanding/approval/document scope | `BLOCKED` — ห้ามเลือกแทน Owner |
| P13 LINE multi-company staff | web ใช้ทุก active membership; LINE/link บังคับ owner-all เมื่อหลายบริษัท; context global ต่อ LINE user | policy เปิดทุก role และ notification เมื่อเพิ่มบริษัทที่สองเป็น security/product decision | `BLOCKED` หลัง P12 |
| P15–P17 Revenue inbox/matching | banking models/import/match/reconciliation มีจริง; scorer มีแต่ production ไม่เรียก/ไม่ persist `SUGGESTED`; ไม่มี classification pipeline | pilot source/volume, accountant beta review, classification approver และ golden dataset | `READY P15 read-only core`; mutation/automation blocked |
| P18–P20 Connectors | ไม่มี production connector; marketplace spec/plan เดิมมีเพียง boundary/backlog | provider/auth/webhook/idempotency/refund/settlement/PDPA/sample fixtures ไม่มี | shared contract/harness `READY`; adapters `BLOCKED` |
| P21 Tax workpaper | TaxPeriod/TaxEvent/9 PP30 boxes/reconciliation/manual filing package มีจริง; full workpaper registers/carry/amendment/form layout/review UI ไม่มี | official form source เก่าเสี่ยง stale; named expert/current fixture และ form mapping ยังขาด | `READY P21-0 core`; official output blocked |
| P22 Auto-accounting | expense spec/plan + memory ระบุ phases implemented และ focused checks; plan ยังเหลือ live authenticated browser rollout check | index เดิมว่า “spec ✅ ฝั่งรายจ่าย” ต่ำกว่าความจริงด้าน code แต่สูงเกินจริงด้าน live proof; revenue sideไม่มี spec | expense `IMPLEMENTED / VERIFY`; revenue blockedหลัง P17 |
| P24 Growth/UX | มี responsive/theme/permission foundations แต่ P24 behavior ยังไม่ implement | trial question เดิมผูก P26 ทำให้ scope 4 สายติด Billing; activation targetยังไม่มี baseline | `READY baseline/UX`; no Billing dependency |

หลักฐาน FlowAccount จากทั้ง public help และการดูบัญชีที่ Owner เปิดไว้แบบ read-onlyสอดคล้องกันว่า sales/purchase ใช้ source documents, payment preparation รวมหลายบิล และ bank reconciliation ให้ระบบเสนอแล้วผู้ใช้ยืนยัน; นี่รองรับ boundary “source-first + human-confirm” แต่ **ไม่ได้พิสูจน์ accounting policy ของ Mangmee ทุกข้อ** — [bank reconciliation](https://flowaccount.com/functions/bank-reconcile), [payment preparation](https://flowaccount.com/help-center/category/expense/payment-slip), [billing-note to invoice without re-key](https://flowaccount.com/help-center/category/sales-function/guide-billing-note), [sales credit note](https://flowaccount.com/help-center/category/sales-function/credit-note).

กรมสรรพากรหน้าแบบปัจจุบันระบุ ภ.พ.30 และใบแนบ ภ.พ.30 พร้อมวันที่ปรับปรุงล่าสุด 28-02-2026; P21 จึงต้อง version/checksum source และห้าม pin layout เก่า — [แบบแสดงรายการภาษี กรมสรรพากร](https://www.rd.go.th/7049.html).

Provider API docs ที่ดูใน browser เป็นเพียง candidate evidence: ตัวอย่างหนึ่งมี raw-body HMAC webhook และ idempotency retention จำกัด จึงเพิ่มข้อกำหนด internal durable idempotency; ยังไม่ถือว่า Owner เลือก provider และไม่ใช้เป็นเหตุให้เริ่ม adapter.

## 4. สิ่งที่แก้จาก audit นี้

1. Restore spec ที่ index ลิงก์แต่ไม่มีใน worktree 9 ฉบับจาก integration ref ที่ตรวจ hash แล้ว.
2. เพิ่ม [Gap Closure Plan](mangmee-four-lane-gap-closure-plan-th.md) ให้ทุกแถวมี phase/ไฟล์ boundary/test/exit/owner gate แทนคำว่า “เขียนตอนเข้าคิว”.
3. แยก `merged`, `branch-only`, `partial-ready`, `blocked`, `live evidence` ใน index.
4. P10/P24 ไม่พึ่ง Billing: เปลี่ยน `requestedPackage` เป็น attribution-only `requestedOfferKey`; P24 trial ใช้ controlled entitlement/allowlist โดยไม่ตัดสินราคา/expiry/quota.
5. P12 ยุติคำถาม LIFF-vs-OAuth ด้วย path ต่อ surface ตาม LINE official docs; คง Provider-console/deep-link gate.
6. P11 เพิ่ม SPF/DKIM/DMARC, SES event/suppression/live gate.
7. P15–P17 ลบ dependency เก่า “หลัง P26”.
8. เพิ่ม provider-neutral [P18–P20 contract](../specs/mangmee-revenue-connectors-contract-spec-th.md).
9. P21 เพิ่ม current official form URL, effective/version/checksum gate และแก้ข้อความ P21-FIN-01 ที่เคยเขียนเหมือนปิดแล้วทั้งที่ current truth ยังเป็น float.

## 5. Owner blockers ที่ต้องตอบก่อน phase ที่ระบุ

1. P10: เว็บไซต์ถือ secret ได้หรือไม่ (HMAC/service JWT), claim TTL/resend/revoke, duplicate taxId verification/review.
2. P28: §10 ข้อ 2–5 ทั้งหมด.
3. P13: active-membership policy ทุก role + notification เมื่อมีบริษัทที่สอง.
4. P15–P17: statement-first/pilot source+volume/accountant-review/matrix approver.
5. P18–P20: provider + pilot account/source + selection evidence.
6. P21/P23/Advisor: named accounting/tax reviewer, current sanitized fixture และ review SLA.
7. P25: next-cohort workload inputs.

Billing/P14/P26 ไม่อยู่ในรายการนี้ตาม scope.
