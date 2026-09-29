# Audit: แยกยอดแชต/รูปจากเพดานระบบ และใช้แหล่งข้อมูลเดียวกันตลอด flow

วันที่: 2026-09-29
สถานะ: **ตรวจ local source/dependencies และปรับข้อกำหนดแล้ว; ยังไม่แก้ application หรือรัน runtime E2E**. อัปเดต 2026-09-29: เพิ่ม §7 ตรวจซ้ำบน develop `8a91bc1c` ตามรีวิว R1 (F-02) — §2–§6 เก็บไว้เป็นประวัติของรอบ `4a5817b4`; บรรทัดโค้ดที่ใช้ได้ให้ยึด §7

ตามคำขอ Owner ให้รวมการแก้ส่วนปรับเครดิตเดิมเข้ากับ add-on และตรวจ field/value/ข้อความทุก flow. อ้างอิง [spec §18](../specs/chat-credit-and-receipt-addons-spec-th.md), [plan §15](../plans/chat-credit-and-receipt-addons-plan-th.md), audit F01–F12/E01–E27 (2026-09-28) และ audit U01–U10/E28–E42 (2026-09-29) — สองไฟล์นี้ไม่มีใน repository (รีวิว R1 F-24) จึงถอดลิงก์; รายการที่ต้องใช้เขียนใหม่ใน [แผน §9–§10](../plans/chat-credit-and-receipt-addons-plan-th.md). ตรวจ working tree ต่อจาก HEAD `4a5817b4` ซึ่งมีงานอื่นแก้ค้าง; ไม่ใช่หลักฐาน deployed source. **หมายเหตุ 2026-09-29 (F-02):** `4a5817b4` ไม่ใช่บรรพบุรุษของ develop (merge-base `69bdc327` วันที่ 2026-09-22, develop นำหน้า 504 commits) จึงไม่เห็น purchase-without-setup PR A–E และ LINE v2 budget authority (`d08bb68a`); ผลตรวจซ้ำอยู่ §7. ไม่แตะ cloud/payment/provider และไม่ใช้ test เก่ารับรอง feature ใหม่

## 1. ข้อสรุปและขอบเขตคำว่า source เดียว

ต้องปรับพร้อมกันทั้ง admin grant, operational settings, paid/package/deal writers, usage admission/settlement, read projections และ UI. ระบบเดิมมีการ reuse resolver/locks/error map อยู่แล้ว ให้ต่อยอดของเดิม ไม่สร้าง wallet service ใหม่หรือให้ Gateway อ่าน DB

ความจริงแต่ละชนิดมีเจ้าของเดียว: ยอดลูกค้าจาก grants/funding entries, ต้นทุนจาก usage evidence, เพดานจาก configuration/policy resolver, สมาชิกจาก paid membership source, เงินจาก invoice/payment/refund evidence. ใช้ API ประกอบผลภายใต้ snapshot/context เดียวแล้วค่อยแยก customer/operator DTO; ไม่ทำให้ข้อมูลคนละหน่วยกลายเป็น field เดียว. ดู ownership และ field dictionary ใน spec §18

```mermaid
flowchart LR
  A[ชำระเงิน / แพ็ก / admin อนุมัติ] --> B[บัญชียอดและแหล่งสิทธิ์]
  C[ตั้งเพดานและนโยบายระบบ] --> D[ตัวตัดสินสิทธิ์และความพร้อมร่วม]
  B --> D
  M[สมาชิกและสิทธิ์งาน] --> D
  D --> E[จอง / เรียก AI / บันทึกผล / ตัดหรือคืนยอด]
  E --> B
  E --> K[หลักฐานต้นทุนจริง]
  B --> R[อ่านข้อมูลจาก snapshot เดียว]
  C --> R
  M --> R
  K --> R
  R --> U[ข้อมูลลูกค้า: ยอดและคำไทย]
  R --> O[ข้อมูลผู้ดูแลตามสิทธิ์]
```

## 2. Findings และแนวทางแก้ร่วมกัน

C01–C12 เป็น source-confirmed behavior และ integration risks ต่อกติกาใหม่ ไม่ใช่ 12 Production incidents. F04 เดิมยังพบ source inconsistency; จุดอื่นไม่อ้างว่า reproduce runtime แล้ว

| ID | หลักฐาน / trigger / ผลกระทบ | แนวทางและ dependency |
| --- | --- | --- |
| C01 — P1: เพดานเดิมไม่ใช่ยอดแถม | [SHARED resolver](../../apps/api/src/modules/line-ai/application/company-ai-budget-policy.ts#L146) ใช้ explicit TOTAL override เป็น CHAT cap ด้วย; [writer](../../apps/api/src/modules/system-partner-management/application/use-cases/set-partner-ai-model.use-case.ts#L81) ตั้งค่ารายเดือนแบบ absolute. ใช้เพิ่มเครดิตจะเปลี่ยนวงเงิน OCR ตาม และไม่ได้ lot 12 เดือน | แยกคำสั่งเพิ่มยอดจากตั้งเพดาน. หลัง commercial cutover included allowance เป็น source ของ cycle; ห้ามใช้ default/deal CHAT allowance เดิมเป็นด่านซ้ำจนซื้อเพิ่มแล้วใช้ไม่ได้. รักษา explicit operational caps และ legacy provenance; cohort ที่จำแนก source ไม่ได้ยังไม่ย้าย |
| C02 — P1: เงื่อนไข SPLIT ติดมาผิดงาน | [flag/model/sum/time/spent guards](../../apps/api/src/modules/system-partner-management/application/use-cases/set-partner-ai-model.use-case.ts#L94) ใช้กับการตั้งนโยบาย ไม่ใช่ grant. ถ้า reuse writer นี้ admin เพิ่มเครดิตอาจเจอให้รอเดือนหน้า หรือให้เพิ่ม TOTAL | คำสั่ง grant ไม่ตรวจ C+O<=T ไม่เปลี่ยน model/โหมด/เพดาน. Usage ยังตรวจ operational policy ตามจริง; readiness ของ commercial reservation ต้องรองรับ SHARED โดยไม่เปิด SPLIT ให้ทุกบริษัทอัตโนมัติ |
| C03 — P1: รูปแถมมีอายุผูกกับสมาชิก | [blocked/maxExpiry](../../apps/api/src/modules/billing/application/billing-receipt-adjustments.service.ts#L62) และ [preview](../../apps/api/src/modules/billing/application/billing-receipt-adjustments.service.ts#L130) จำกัด expiry ไม่เกิน term/paid-through; ไม่ตรง D8 | New grant คำนวณ 12 เดือนจาก appliedAt โดย server; ฟอร์มไม่ให้เลือกวันขัด policy. Membership/use eligibility แยกจาก validity; legacy grants ไม่ยืดอายุย้อนหลัง. สถานะ/สิทธิ์สร้างรายการยังตรวจตาม scope เดิม ไม่เปิด admin ให้ข้าม security |
| C04 — P1: pending checkout บล็อก admin grant ทั้งหมด | [blocked](../../apps/api/src/modules/billing/application/billing-receipt-adjustments.service.ts#L68) และ source hash ผูก activeAttempt/collection ทั้งบัญชี; admin กับ paid ที่แค่เพิ่มยอดเฉพาะสินค้าอาจถูกกันโดยไม่เกี่ยวกัน | แยก serialization ของ balance จาก exclusivity ของ checkout. Grant ไม่ครอบครอง/clear activeAttemptId; ตรวจ source ที่มีผลจริงและ revalidate under lock. ความขัดแย้งทางสิทธิ์/สมาชิก/เงินที่ยังไม่ทราบต้องมีเหตุผลและกลับรายการเดิมได้ ไม่ตัด guard ทิ้ง |
| C05 — P1: FEFO เดิมไม่มีลำดับ package→gift→paid | [paidReceiptBalance](../../apps/api/src/modules/billing/application/billing-receipt-grants.ts#L8) เรียง expiry รวมทุก grant และใช้ admissions count. เพิ่ม ADD_ON ลงตารางเดิมเฉย ๆ อาจตัดซื้อก่อนแพ็ก และนับ held เป็น used | Reader/admission/settle ใช้ allocation เดียวตาม source class ก่อน FEFO ภายในกลุ่ม; logical receipt effects แยกจาก admission/provider events ตาม F07. Operator/customer ใช้ net ตัวเดียว แต่เปิดเผยรายละเอียดต่างกัน |
| C06 — P1: lifecycle writers อาจแตะ lot ผิดประเภทถ้า reuse kind | [REPEAT carry](../../apps/api/src/modules/billing/application/billing-receipt-grants.ts#L48), [แถมวัน](../../apps/api/src/modules/billing/application/billing-free-days.ts#L183), [grace extend](../../apps/api/src/modules/billing/application/billing-reconciler.service.ts#L1210), [grace restore](../../apps/api/src/modules/billing/application/billing-reconciler.service.ts#L1335) ปัจจุบัน whitelist package kinds ถูกต้อง | รักษา whitelist เดิม; new paid/admin product lots ต้องมี source/product discrimination ที่ไม่ถูกต่ออายุ/ตัดอายุ/reset ตามแพ็ก. ไม่ reuse INITIAL/REPEAT เพื่อหลบ validator; recurring/package flow ไม่เรียก ADD_ON apply |
| C07 — P1: writers นอกหน้าผู้ดูแลเปลี่ยนเครดิตได้ | [deal apply](../../apps/api/src/modules/billing/application/billing-package-request.ts#L86), [deal return](../../apps/api/src/modules/billing/application/billing-reconciler.service.ts#L1332), [platform default](../../apps/api/src/modules/system-partner-management/application/use-cases/set-platform-ai-budget.use-case.ts#L67) เปลี่ยน config/allowance. ถ้าใหม่อ่านแต่ ledger แล้ว writer เก่ายังลง config สิทธิ์จะไม่ตรงกัน | ทำ writer ownership matrix: package/deal เปลี่ยน allowance policy ตามรอบที่อนุมัติ; operational settings เปลี่ยนเฉพาะ cap; gift/paid เปลี่ยน lot. ทุก writer refresh source/version เดียว ไม่สร้าง grant ฟรีกลางรอบ ลบยอดซื้อ หรือเปลี่ยน invoice snapshot |
| C08 — P1: consumer มากกว่าแชต LINE/อัปโหลดรูป | [CRM](../../apps/api/src/modules/crm-inbox/infrastructure/crm-ai-gateway.client.ts#L84), [draft](../../apps/api/src/modules/ai-draft/application/use-cases/generate-suggestion.use-case.ts#L148), [capture](../../apps/api/src/modules/expenses/infrastructure/expense-capture-read.client.ts#L151), [statement](../../apps/api/src/modules/banking/infrastructure/statement-ai-extract.client.ts#L54) ใช้ common meter; [capture job](../../apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts#L430) นับหนึ่งครั้งต่อ job | ทำ route→cost bucket→commercial product matrix จาก trusted source/content. CHAT เดิมที่เข้า scope ใช้ allocation ร่วม ไม่หักซ้ำผ่าน caller และ meter. OCR bucket ไม่ได้แปลว่า receipt product เสมอ; statement/PDF/multipage ไม่ใช้ IMAGE add-on. Preserve existing rights; deterministic no-provider ไม่ถูก debit |
| C09 — P1: shared resolver ยังไม่เท่ากับ shared snapshot | [AI usage read](../../apps/api/src/modules/system-partner-management/application/use-cases/get-partner-ai-usage.use-case.ts#L280) มี RepeatableRead อยู่แล้ว แต่ [receipt list](../../apps/api/src/modules/billing/application/billing-receipt-adjustments.service.ts#L109) และ [timeline](../../apps/api/src/modules/system-partner-management/application/use-cases/get-partner-timeline.use-case.ts#L171) อ่านหลายชุด; [readiness](../../apps/api/src/modules/line-ai/application/company-ai-budget-readiness.ts#L97) ตอบ OK โดยไม่มี request bound ได้ | Reuse consistent transaction/context ของ AI read ให้ projection ที่มีหลาย source; pin company/asOf/cycle/month/revisions. AVAILABLE ไม่รับประกันทุกคำถาม/ไฟล์; admission ต้องประเมิน request จริงอีกครั้ง. ห้ามคำนวณ wallet จาก cap-used หรือ readiness OK |
| C10 — P1: เดือนต้นทุนและรอบสิทธิ์เป็นคนละแกน | [parent step](../../apps/api/src/modules/line-ai/presentation/http/internal-ai-budget.controller.ts#L95) ยังไม่ select parent.monthKey แต่ใช้ body.monthKey; ต่อเข้ารอบสมาชิกจะเสี่ยง fund จากผิดรอบ/เดือน | ปิด F04 พร้อมงานนี้: parent DB เป็น authority ของ company/month/cycle/funding/policy/pricing; body ไม่เปลี่ยน authority. Preserve calendar cost/pending caps แยกจาก anniversary allowance และ per-lot expiry; ~~ไม่ reuse UTC calculator~~ — แทนด้วย T-01 (2026-09-29): รอบตามช่วงที่ชำระใช้ `appendPackageInterval`/`billingAnchorDay` แบบ UTC ของ billing และแสดงเวลาไทย (สเปก §5.1) |
| C11 — P1: คืนหน่วย/แก้ต้นทุน/ปล่อย hold ต่างเหตุการณ์ | [operator holds](../../apps/api/src/modules/system-partner-management/application/use-cases/partner-ai-credit-holds.use-case.ts#L85) อ่านเพียงสองเดือน; [usage adjustment](../../apps/api/src/modules/line-ai/application/company-ai-usage-meter.ts#L842) แก้ aggregates เดิม. ถ้าแก้ cost แล้วแปลเป็น refund ทุกครั้งอาจคืนเงิน/หน่วยผิด หรือของเก่ากู้ไม่ได้ | เงินต้นทุนและหน่วยบริการมี effect แยกผูก operation เดียว. New/old-month funding holds ต้องค้นกู้จากต้นทางได้; refund/revoke/settle/correction ใช้ source/version locks ครบ ไม่ mint grant ชดเชยซ้ำ ไม่หยิบยอดใหม่จ่าย late evidence แทน |
| C12 — P1: form/errors/recovery อาจขัด source ใหม่ | [contract null/undefined](../../packages/contracts/src/partner-management.ts#L190), [admin form](../../apps/web/src/features/billing-admin/BillingReceiptAdjustmentsPage.tsx#L15), [Thai budget errors](../../apps/web/src/common/api/api-error-message.ts#L41) เป็น semantics เดิม; [signup alert](../../apps/api/src/modules/external-signup/application/signup-ops-alert.service.ts#L231) และ timeline สรุป operational cap เป็นเครดิต | UI แยก “เพิ่มยอดให้ลูกค้า” กับ “ตั้งเพดานต้นทุน AI”; คงแปล known errors เดิมเฉพาะงานเดิม. Public cause/action อ่าน canonical decision ไม่เดาจาก code รวม. Invalid input/permission/stale/source/payment unknown มีคำไทยและ action เฉพาะขั้น; ป้องกัน raw errors ตาม U08 และ queued LINE ตาม U07 |

## 3. Dependency inventory ที่ต้องปิดพร้อมกัน

| เส้นทาง | Modules ที่ต้องตรวจ/เปลี่ยน | Invariant |
| --- | --- | --- |
| Admin เพิ่ม/ยกเลิกยอด | billing-receipt-adjustments, billing-approval/configuration/admin access, billing-admin UI, partner AI page, contracts | shared grant ไม่ตั้ง cap; source/approval/idempotency คงอยู่; grant success != usage success |
| ตั้งเพดาน/ค่าเริ่มต้น | set-partner-ai-model, set-partner-ocr-config, set-platform-ai-budget, company-ai-budget-policy, PlatformAiBudgetPage | ไม่ mint/revoke หน่วย; active/pending config และ null semantics ถูก; default ไม่เท่ากับ live flag |
| ซื้อ/ต่ออายุ/ดีล/แถมวัน/หมดสมาชิก | billing service/reconciler/package-request/free-days/trial-carryover/receipt-grants, plan-term sweep/lifecycle/AuthGuard | package-only expiry mutations; anniversary D9; additional lots 12 เดือน; security disable ไม่ถูกชุบจาก grant |
| Provider entry points | LINE ai-gateway client, receipt-ocr client, expense-capture client/runner, statement client, CRM client, draft generation | route/product ตรง; one logical consumption; no provider/no charge; authorization ทุกช่องทาง |
| Parent/child/settlement | API budget controller, meter/reservation, Gateway envelope/step/settle/runtime, operator hold repair | ไม่มี direct DB ใน Gateway; source-pinned funding; unknown outcome ไม่ปล่อยฟรี; cost/unit แยก |
| Read/operations | billing status/usage/receiptQuotaSnapshot, AI usage/readiness, timeline, billing plan/receipt previews, signup ops alerts | reuse resolver และ atomic snapshot; ยอด/เหตุผลไม่ต่างกันตามหน้าที่เปิด |
| UI/คำตอบ/เอกสาร | BillingPage, partner/admin pages, expense/banking/CRM/draft UI, shared error helper, LINE immediate/drain, notifications/history/export | ไทย/หน่วย/วันที่ตรง; hidden holds; no fake paid invoice; prior template queue ไม่ค้าง |
| คืน/ยกเลิก/กระทบยอด | refunds, billing-financial/provider observers, paid apply, admin revoke, OCR compensation, usage correction | no duplicate effect; original source/price; expired lots ไม่ฟื้น; retained history ไม่พึ่ง raw LINE retention |

## 4. Error/guard ที่ต้องย้ายให้ตรงงาน

| เงื่อนไขเดิม | เมื่อเพิ่มยอดแชต/รูปใหม่ | เมื่อปรับ operational settings / เริ่มใช้ |
| --- | --- | --- |
| SPLIT flag/model/C+O<=TOTAL/เริ่มเดือนหน้า | ไม่ใช้เป็น validator ของจำนวน grant | รักษากติกาของ config; usage ตรวจ model/bound และ policy readiness จริง |
| expiry<=term/paidThrough | New lot 12 เดือนจาก source time; legacy ไม่แก้ย้อนหลัง | สมาชิกหมดพักใช้ยอด valid; ไม่ขยายสมาชิกเพื่อให้ grant ผ่าน |
| active checkout/collection | ไม่ blanket block รายการ gift ที่ไม่แก้ package/payment; serialize/recheck เฉพาะ source เกี่ยวข้อง | ~~customer checkout ยัง reuse single active attempt~~ — ยกเลิกโดย T-02: checkout ของ add-on ใช้ slot `activeAddOnAttemptId` ของตัวเอง (สเปก §9.1); conflict จริงไปตรวจรายการเดิม |
| spent+held floor / OCR monthly cap | ไม่แปลงยอด grant เป็น cap และไม่ reset used count | เป็น internal constraints; ชี้เหตุจริงและไม่ชวนซื้อเมื่อซื้อแก้ไม่ได้ |
| 403 / stale / expired preview / key conflict | รักษาไว้พร้อมคำไทย; ไม่ถือเป็น bug ที่ต้อง bypass | อ่านข้อมูลใหม่/ตรวจสิทธิ์/กลับคำขอเดิม ไม่ส่งซ้ำด้วย key ใหม่อัตโนมัติ |
| ระบบ/ข้อมูลอ่านไม่ได้ | ไม่คืน 0/null/unlimited ปลอม และไม่กล่าวว่าไม่มีการเพิ่มยอดก่อนตรวจผล | unavailable พร้อมทางลองอ่าน/ตรวจรายการเดิม; ไม่เปิดใช้แบบไม่ตรวจสิทธิ์ |

คำว่า “ห้ามมี block” ใช้เป็นเกณฑ์ว่า **flow ที่มีสิทธิ์และข้อมูลถูกต้องต้องไม่ถูกปฏิเสธจากเงื่อนไขคนละงานหรือข้อมูลคนละรุ่น**. การกันใช้เกิน สิทธิ์ไม่พอ และผลเงินไม่ทราบยังต้องอยู่ พร้อมข้อความ/ทางไปต่อที่ตรงข้อเท็จจริง

## 5. Acceptance เพิ่ม E43–E60 — ทั้งหมดยังไม่รัน

| ID | Scenario | ผลที่ต้องตรวจ | Spec |
| --- | --- | --- | --- |
| E43 | Admin เพิ่ม CHAT ขณะ SHARED/SPLIT flag ปิด/มี pending cap | lot ถูกชนิดครั้งเดียว; cap/model/policy/month ไม่เปลี่ยน; read แสดงยอดใหม่และ usage state จริง | A25/A26 |
| E44 | เพิ่ม IMAGE ขณะสมาชิกเหลือ 10 วัน → lapse → renew | new grant อายุ 12 เดือนจาก apply; หยุดใช้เมื่อ lapse แต่ยอดคงอยู่; legacy expiry ไม่เปลี่ยน | A26/A29 |
| E45 | Paid apply กับ admin grant พร้อมกัน และมี checkout/collection เดิม | รวมยอดทั้งสองถูก ไม่มี false account-wide block/activeAttempt ถูก clear ผิด; conflict จริง revalidate | A26/A30 |
| E46 | ตั้ง SPLIT ไม่พร้อม/ผลรวมเกิน/ลด cap ต่ำกว่า spent+held/เปลี่ยนกลางเดือน | error ไทยตรงงาน config; grant ไม่ต้องกรอก cap; ไม่มี provider/unit mutation จาก config error | A25/A31 |
| E47 | Package/gift/paid หลาย expiry โดย paid หมดก่อน package | ตัด package→gift→paid แล้ว FEFO ภายในกลุ่ม; wallet/operator/receipt history ตรงกัน | A27/A28 |
| E48 | Repeat/upgrade/renew/free-days/grace start+restore รอบมี additional lots | package behavior เดิม; ไม่มี extend/shorten/reset additional หรือเพิ่มแชตกลางรอบโดยผลข้างเคียง | A29 |
| E49 | Deal apply/return/expiry และ platform default เปลี่ยน | allowance provenance/cycle ถูก; no duplicate grant/no paid balance loss; current/pending policy ไม่ขัดกัน | A25/A29 |
| E50 | Config null/omitted/0/pending reaches month, concurrent admin/platform writes | field semantics เดิมคงอยู่; effective source/version ตรงทั้ง admission/read/preview; no lock inversion | A25/A27/A30 |
| E51 | LINE text/image, Web receipt, statement, CRM, draft, deterministic no-provider | route/cost bucket/commercial product ตรง; non-receipt OCR ไม่กิน IMAGE; no double CHAT debit; entitlement เดิมครบ | A28 |
| E52 | Capture one-page image แตกหลาย chunks, PDF/multipage, resume/re-read/partial | IMAGE หนึ่งครั้งเมื่อ durable usable result ตาม D4; excluded files คงสิทธิ์แพ็ก; resume ไม่กินซ้ำ; ต้นทุนจริงยังครบ | A28/A30 |
| E53 | อ่าน customer/operator/timeline/preview ระหว่าง grant/use/refund | snapshot/version/company เดียวในหนึ่ง response; public/operator totals เท่ากัน; pending/error ไม่แสดง 0 ปลอม | A27 |
| E54 | Child invocation ข้ามต้นเดือน/anniversary; body ส่งเดือนต่าง parent | DB parent เป็น authority; reject mismatch; cost month/cycle/lot ไม่สลับ; ไม่มี provider ซ้ำ | A28/A30 |
| E55 | Hold เก่ากว่าสองเดือน, late settle/correction หลัง expiry/cutover | operator ค้นกู้ได้; ไม่ชุบ lot/ดึง lot ใหม่ผิด source/ปล่อย unknown ฟรี; public ไม่เห็น held fields | A30 |
| E56 | Admin revoke, money refund, OCR unit return และ usage correction ชนกัน | effect คนละชนิดทำครั้งเดียว; source money vs units ไม่ปน; no fake receipt for gift | A26/A30 |
| E57 | CHAT 0.01/50; IMAGE 1/20; ราคา299/349; invalid decimal/overflow/null | 1/5000 CHAT units, 1/20 IMAGE units, 29900/34900 satang; invalid ไม่มี mutation; null ของ config ไม่เป็น wallet unlimited | A25/A31 |
| E58 | UI/API รุ่นเก่า, company switch, out-of-order response, plain Error, missing summary | ไม่มี field reinterpretation/stale overwrite/raw error; unavailable เฉพาะ feature ที่ไม่พร้อม ไม่ปิด legacy ที่ยังใช้ได้ | A27/A31/A32 |
| E59 | ทุก guard cause ผ่าน Web/LINE/queued LINE/CRM/draft/admin; valid retry | ข้อความและ action ตรง; ไม่ชวนเพิ่มยอดเพื่อแก้ cap; deterministic ไม่โดน provider-budget gate ที่ไม่เกี่ยว; queued integrity/idempotency คงเดิม | A28/A31 |
| E60 | Cohort migration, single product gate on/off, old readers/rollback compatibility | activate เมื่อ dual-read reconciliation/consumers พร้อม; sales closed ไม่ลบ paid/admin rights; ไม่ force SPLIT หรือ backfill gift จาก TOTAL | A29/A32 |

รวม E01–E60 = **60 acceptance scenarios ที่ยังไม่รัน**. การเพิ่มรายการไม่แปลว่า coverage พิสูจน์แล้ว; P6 ต้องแนบผลจริง/ข้อจำกัดตาม route, company cohort, payment mode และ error branch

## 6. Verification ที่มีอยู่และข้อจำกัด

อ่าน test/source inventory เพื่อวางแผน reuse: set-partner-ai-model/use-case specs, set-platform-ai-budget specs, ai-budget.logic specs, billing-receipts/grace/trial-carryover PG checks และ admin adjustment smoke scripts. Browser paths ที่มี: [customer billing](../../e2e/customer-billing-ux.spec.ts), [admin billing](../../e2e/billing-admin-menu-ux.spec.ts), [readiness](../../e2e/plan-term-billing-readiness.spec.ts), [capture](../../e2e/expense-capture-intake.spec.ts), [banking](../../e2e/banking.spec.ts), [LINE recovery](../../e2e/line-recovery.spec.ts). ไม่ execute scripts เหล่านี้ในงานเอกสาร และไม่อนุมานว่าแต่ละไฟล์ครอบคลุม flow ใหม่อยู่แล้ว

ตรวจได้รอบนี้: link/source-line bounds, decision/acceptance IDs, field semantics, ราคา/หน่วย/ตัวอย่างยอด, contradiction scan และ source producer/consumer inventory. ยังไม่พิสูจน์ DB race, provider bounds ทุกโมเดล, live payment/refund, browser rendering หรือ Production readiness. ผล runtime ต้องบันทึกภายหลังพร้อม source/schema/policy/template versions; คงงานอื่นใน working tree

ผลตรวจเอกสารของรอบ `4a5817b4` (ประวัติ; บรรทัดโค้ดไม่ตรง develop ตาม §7): **PASS** 9 docs, 132 local links, 84 source-line bounds; D1–D12/A01–A32/E01–E60/C01–C12 ครบไม่ซ้ำ, reference ถูก, ราคาหกชุด/หน่วย/อายุไม่เปลี่ยน, JSON allowlist/ยอด/วันตรง, D9 ยืนยันครบ และ whitespace ผ่าน. `git diff --check` ของ legacy spec/ADR notes ผ่าน. ไม่มี application test หรือ runtime E2E ในผลนี้

## 7. ตรวจซ้ำบน develop 8a91bc1c (2026-09-29)

วิธีตรวจ: อ่านไฟล์จริงที่ develop `8a91bc1c` (checkout read-only) ทุกบรรทัดที่อ้างด้านล่าง; origin/develop `69fba9d3` ต่างจาก `8a91bc1c` เฉพาะ `.github/workflows/extended-tests.yml:286` จึงใช้ได้กับ develop ปัจจุบัน. ตัดสิน: **ยืนยัน** = พฤติกรรมตรงกับที่ audit อ้าง; **บางส่วน** = ถูกแต่ไม่ครบหรือมีส่วนที่ยังไม่เกิด; **ล้าสมัย** = ไม่ตรงโค้ดแล้ว. E43–E60 ใน §5 ใช้ต่อเป็น AO-E43–AO-E60 ใน [แผน §9](../plans/chat-credit-and-receipt-addons-plan-th.md)

| ID | ผล | บรรทัดที่ถูกต้องบน develop | หมายเหตุ / ผลต่อแบบ |
| --- | --- | --- | --- |
| C01 | ยืนยัน | resolver `apps/api/src/modules/line-ai/application/company-ai-budget-policy.ts:146-151` (logic `:149-151`; ลิงก์เดิม `#L146` ชี้ comment); writer ตั้งค่าแบบ absolute `system-partner-management/application/use-cases/set-partner-ai-model.use-case.ts:81,122-133,349-356` | ข้อความคอนโซลยังชวน “เพิ่มเครดิต” ด้วยการยกเพดาน (`apps/web/src/features/system-partners/PartnerDetailPage.tsx:1940`, `PlatformAiBudgetPage.tsx:90-134`) → สเปก §18.2/T-06; การนับ override เป็นสิทธิ์ = Q5 |
| C02 | ยืนยัน (แต่ premise ต่อยอดในสเปกล้าสมัย) | guard ของการตั้งค่า `set-partner-ai-model.use-case.ts:93-107,249-265,277-283,286-327` | สเปกเดิม §15.2 “engine รับ SPLIT เท่านั้น” ล้าสมัย: เส้นทาง rendered ของ LINE v2 จอง durable ใน SHARED แล้ว (`company-ai-budget-reservation.ts:335-339` ผ่าน `line-ai-budget-authority.service.ts:310-337`) → สเปก §5.3/T-04 |
| C03 | ยืนยัน | `billing/application/billing-receipt-adjustments.service.ts:62-74` (blocked/maxExpiry), `:128-134` (preview ตรวจ expiry), `:186-188` (เขียน `ADMIN_ADJUSTMENT`) | แบบใหม่ไม่มีช่องกรอก expiry (สเปก §16 ข้อ 4, F-21) |
| C04 | ยืนยัน | source hash รวม `activeAttemptId`/`activeCollectionOperationId` `billing-receipt-adjustments.service.ts:57-61`; บล็อก `:68` | ปัญหาเดียวกันรุนแรงกว่าใน checkout ของ add-on ถ้าใช้ slot ร่วม → T-02 (F-01) |
| C05 | ยืนยัน | FEFO รวม `billing/application/billing-receipt-grants.ts:8-22` (นับ `_count.admissions` `:14-17`); admission ผูก grant `line-ai/application/company-ocr-governance.ts:294-300`; คืนหน่วยลบ event `:466` | ขาดการจัดกลุ่ม TRIAL_CARRYOVER และฐานรายเดือน legacy; flow แพ็กเกจอ่านทุก kind (`billing.service.ts:495`, `billing-reconciler.service.ts:600`) → สเปก §6.1 (F-16) |
| C06 | ยืนยัน แต่รายการไม่ครบ | whitelist `billing-receipt-grants.ts:48-54`, `billing-free-days.ts:183-184`, `billing-reconciler.service.ts:1221-1222,1349-1350`; ที่ขาด: `billing-end-package.ts:63-64`, `billing-package-request.ts:21-22`; `billing-upgrade.ts:23-26` อ่านทุก kind แล้วกรองเอง (ปลอดภัย) | เพิ่มสามไฟล์เข้า regression list (สเปก §6.1) |
| C07 | บางส่วน | ที่อ้างถูก: `billing-package-request.ts:83-95` (apply ดีล), `billing-reconciler.service.ts:1346-1348` (คืนดีล), `set-platform-ai-budget.use-case.ts:55-82` (ค่ากลาง); ที่ขาด: `billing-reconciler.service.ts:671-672` (ซื้อแพ็กครั้งเดียวล้างเครดิตของดีล), `:1386-1388` (subscription INITIAL ล้าง), `set-partner-ocr-config.use-case.ts:77` (upsert config OCR) | เพิ่มเข้า writer matrix (สเปก §18.3) |
| C08 | บางส่วน | ที่อ้างถูก: CRM `crm-inbox/infrastructure/crm-ai-gateway.client.ts:84-96`, draft `ai-draft/application/use-cases/generate-suggestion.use-case.ts:147-155`, capture `expenses/infrastructure/expense-capture-read.client.ts:158-171`, statement `banking/infrastructure/statement-ai-extract.client.ts:54-66`, หนึ่ง admission ต่อ job `expenses/application/services/expense-capture-read-runner.service.ts:446-463`; ที่ขาด: lane v2 ทั้งหมดใช้ bucket CHAT (`line-ai-budget-authority.service.ts:16-18,85,311`: ส่วนตัว, PUBLIC_GENERAL, document QA, ร่างเบิกจ่าย), admission รูป LINE ต่อรูปที่ intake (`line-ai/infrastructure/ai-gateway.client.ts:486-495`), web receipt (`expenses/infrastructure/receipt-ocr.client.ts:295-334`) | ตาราง route→สินค้า สเปก §5.4; การตัดสิน PUBLIC_GENERAL = Q3 (F-17) |
| C09 | ยืนยัน | RepeatableRead ของ AI usage `get-partner-ai-usage.use-case.ts:203,234,280`; อ่านหลายชุด `billing-receipt-adjustments.service.ts:108-120` และ `get-partner-timeline.use-case.ts:175-182` (ลิงก์เดิม `#L171`); readiness ตอบ OK โดยไม่มี bound `company-ai-budget-readiness.ts:13-15,88-98` | สเปก §18.4 ข้อ 3 |
| C10 | ยืนยันสำหรับ v1 (บรรทัดเลื่อน) | v1 select parent ไม่มี `monthKey` `line-ai/presentation/http/internal-ai-budget.controller.ts:111-114` และใช้ `body.monthKey` `:122-123`; ลิงก์เดิม `#L95` ตอนนี้เป็น branch v2 (`:91-99`); v2 pin เดือนใน HMAC grant `line-ai-budget-authority.service.ts:134` | แก้ v1 ใน PR D; v2 เก็บรอบ/funding ใน `budgetAuthorityJson` (สเปก §5.3, §15.2) |
| C11 | บางส่วน | operator อ่านสองเดือน `partner-ai-credit-holds.use-case.ts:84-90` (ยืนยัน); `recordCompanyAiCostAdjustment` `company-ai-usage-meter.ts:788` ยังไม่มีผู้เรียก (comment `:783-786`) จึงเป็นความเสี่ยงล่วงหน้า | ความสำคัญ = ก่อนมีผู้เรียกรายแรก (F-29); hold เก่าค้นได้ใน PR C |
| C12 | ยืนยัน (บรรทัดเลื่อน) | contract null/undefined `packages/contracts/src/partner-management.ts:200-220` (ลิงก์เดิม `#L190`); ฟอร์มผู้ดูแล `apps/web/src/features/billing-admin/BillingReceiptAdjustmentsPage.tsx:12-22`; error ไทย `apps/web/src/common/api/api-error-message.ts:965-968` (ลิงก์เดิม `#L41`); ops alert ข้อความ `external-signup/application/signup-ops-alert.service.ts:54-81` และ logic `:215-242` (ลิงก์เดิม `#L231`) | ขัดกับคำ W-01 ที่ใช้ “เครดิต AI” กับเพดานของผู้ดูแล → T-06 “เพดานเครดิต AI ต่อเดือน” |

สรุป: ไม่มีข้อใดล้าสมัยทั้งข้อ; C07, C08, C11 เป็น “บางส่วน”; C10 และ C12 บรรทัดเลื่อน; premise หนึ่งข้อที่สเปกเดิมสร้างต่อจาก C02 (SHARED จอง durable ไม่ได้) ล้าสมัย

### 7.1 ข้อสังเกตใหม่จากการตรวจซ้ำ

| ID | ข้อสังเกต | หลักฐาน | ผลต่อแบบ |
| --- | --- | --- | --- |
| N-1 | LINE v2 จอง intake รูป (`line-intake-image/2`) เป็น bucket CHAT เสมอ ขณะที่ classifier v1 ให้ intake ที่มีรูปเป็น OCR | `line-ai-budget-authority.service.ts:126-127,311`; `company-ai-usage-meter.ts:61-81`; สเปก 80 “ห้ามหักต้นทุน OCR จากเครดิตแชต” | funding ของเครดิต AI ไม่ตัด intake รูป (สเปก §5.4, แผน PR C4); เจ้าของ LINE AI ต้องยืนยันเจตนาของ bucket ใน v2 — **ยังไม่ได้ยืนยัน** |
| N-2 | Slot ของแพ็กเกจกั้นการกระทำอื่นมากกว่าที่รีวิวระบุ | `billing-price-return.ts:94,117`, `billing-repeat.ts:44`, `billing-admin-collection.ts:41,67`, `billing-document-admin.service.ts:59-60,417`, `billing.service.ts:941` (`recipient.canChange`) | ยืนยันเหตุผลของ T-02; ไม่ต้องแก้ guard เหล่านี้เพราะ add-on ใช้ slot แยก |
| N-3 | PROMPTPAY_RENEW เก็บ attempt แรกไว้ใน `activeAttemptId` หลัง apply จนกว่า binding ของ subscription สำเร็จ | `billing-reconciler.service.ts:657-658,1088-1142` | ร้าน QR ใหม่อาจมี slot แพ็กเกจไม่ว่างชั่วคราว; add-on ไม่อิง slot นี้ (T-02) |
| N-4 | การ์ดแจ้งโควตารูปหมดใช้ claim ต่อ monthKey บน `CompanyPlanTerm` และการเขียน `CompanyPlanTerm` เปลี่ยน `updatedAt` ที่ quote แพ็กเกจใช้ตรวจ | `company-ocr-governance.ts:145-178`; `billing-receipt-grants.ts:56-58`; `billing.service.ts:571,691` | ยอด ADD_ON ไม่เขียน `CompanyPlanTerm`; claim ใช้รุ่นของยอด (สเปก §6, F-19) |
| N-5 | Operation `CUSTOMER_PROFILE_SYNC` ของ purchase-without-setup ไม่ยึด slot ใดของบัญชี | `billing/application/billing-company-profile.ts:44-59` | ข้อกังวล F-31 ข้อนี้ไม่เกิดบน develop |
| N-6 | กฎ “ไม่มีตัวเลขเงินใน LINE” มีอยู่แล้วในแจ้งเตือนแพ็กเกจและประกาศดีล | `billing-notifications.service.ts:265-272`; `sales-console/domain/sales-deal.logic.ts:196-202` | แจ้งเตือน add-on ไม่มีตัวเลข (สเปก §9.3) แทนข้อเสนอของรีวิวที่ใส่จำนวนในแจ้งเตือน |
| N-7 | Unit/PG spec ที่เกี่ยวข้องมีอยู่แล้วและลงทะเบียนแล้ว | `internal-ai-budget.controller.spec.ts` (catalog `:476`), `company-ai-budget-reservation.spec.ts` (`:475`), `line-ai-budget-authority.pg.spec.ts` (`LINE_AI_RELIABILITY_POSTGRES_SUITES` `:536`) | แผนขยายไฟล์เหล่านี้แทนการสร้างใหม่ |

### 7.2 สิ่งที่ยังตรวจไม่ได้

- ค่าบน Production: ความพร้อมของ LINE v2 (`/internal/ai/line-reliability-capabilities`), ค่า `LINE_AI_RELIABILITY_V2_MODE` ของ task, AgentCore runtime, `PlatformAiBudgetConfig`, จำนวนร้านต่อ cohort (แผน §3.6, PR G)
- พฤติกรรม Stripe ของ native one-time Price และการคืนเงิน PromptPay ในบัญชีนี้
- งานแก้ purchase flow ที่ยังไม่ merge และ migration `20260929030000` ที่ controller แจ้ง (ไม่พบบน branch ที่ push แล้ว)
- เจตนาของ bucket CHAT สำหรับ intake รูปใน v2 (N-1)
