# Billing controls 1–8 — ควบคุมผ่าน Admin เว็บและกู้ปัญหาได้

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](../plans/mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูปและใช้โควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full paid E2E ยัง NOT RUN; current tests ไม่แทน provider acceptance.

สถานะ 2026-09-11: **DESIGN SPEC / C01–C08 target controls NOT IMPLEMENTED as a complete suite**. User เลือกให้ครอบคลุมทั้ง 8 ข้อ. ใช้ [owned billing design](mangmee-owned-billing-integration-spec-th.md), [customer UI](mangmee-line-web-billing-ui-spec-th.md), [P26](mangmee-billing-subscription-spec-th.md), [implementation/E2E plan](../plans/mangmee-billing-controls-plan-th.md) และ [impact/gap register](../research/billing-controls-impact-2026-09-11.md).

**Developer readiness review:** เริ่ม foundation และ local fixtures ได้ แต่ยังไม่ใช่สัญญาว่า developer ทำครบทุก flow ได้โดยไม่มีมติเพิ่ม. ใช้ [readiness / flow coverage](../research/billing-developer-readiness-2026-09-11.md) และข้อกำหนด §7 ที่เติมจุดต่อสำคัญ; E0 signup, B01–B10 และ operator approval/setup ยังเป็น dependencies ตาม action ที่เกี่ยวข้อง.

## 1. เป้าหมายและ no-deploy contract

ทีมมั่งมีต้องดูบริษัท/เงิน/สิทธิ์ ค้นปัญหา ตั้งค่าที่รองรับ และดำเนินงานเดิมต่อผ่านเว็บได้. ลูกค้าทั้ง web และ LINE ใช้บริษัทและสถานะชุดเดียวกัน. “ไม่มีทางตัน” หมายถึงทุกผลลัพธ์มีทางที่ได้รับอนุญาตไปต่อ พร้อมเหตุผล/reference/status; ไม่ใช่การข้ามสิทธิ์หรือบังคับให้ mutation สำเร็จเสมอ.

- **หลัง implementation ครั้งแรก** การปรับค่าที่มี schema รองรับต้องเป็น DB-backed configuration/command ผ่านเว็บ ไม่ใช่แก้ source/.env, SSH, SQL โดยมือ หรือ deploy/restart เพื่อเปลี่ยนค่า.
- แยกการบันทึก desired revision, การ validate/approve, การ execute และ observed revision ของ API/worker/provider. UI ห้ามขึ้น “มีผลแล้ว” จาก HTTP 200/202 ที่รับคำสั่งเท่านั้น.
- Emergency stop new sales ต้องตรวจ authoritative gate อีกครั้งก่อน provider mutation; cache หรือ propagation ที่ยังไม่ยืนยันห้ามปล่อย new sale. Cached UI อาจแสดงปุ่มเก่า แต่ backend ต้องปฏิเสธพร้อมทางอ่านสถานะ/ติดต่อ.
- Read model refresh ใช้ observedAt/revision, invalidate หลังเปลี่ยนค่า และ polling ที่มีขอบเขตตาม UI spec. เป้าทดสอบ propagation ภายใน 30 วินาที; ไม่ใช่ SLA ลูกค้า. ถ้ายังใช้ค่าเก่าให้แสดง pending/mismatch พร้อม retry และคิวปัญหา.
- เปลี่ยน business rule ชนิดใหม่, schema, adapter/API version หรือรองรับ provider ใหม่ ยังต้องเปลี่ยนโค้ด/ทดสอบ/ปล่อยรุ่น. ไม่สร้างช่องรัน script/SQL หรือกรอก environment variables อิสระใน Admin.
- รหัสลับอยู่ secret provider เดิม; หน้าเว็บแสดง health/version/rotate workflow เฉพาะ capability ที่รองรับ ไม่คืน secret หลังบันทึก. Credentials/setup ที่ provider ต้องให้เจ้าของบัญชีดำเนินการ มี checklist/ลิงก์ปลายทางที่ตรวจแล้วและกลับมาตรวจสถานะได้ ไม่เป็นปุ่มเงียบ.

## 2. หน้าเว็บและ navigation

ต่อยอด `/system` และ Partner detail เดิม. ชื่อ routes ด้านล่างเป็น **target**, ไม่ใช่หน้าที่เปิดใช้แล้ว.

| หน้า | Route | เนื้อหาและทางกลับ |
|---|---|---|
| ภาพรวม | `/system/billing` | รายบริษัท/ตัวกรอง env, status, อายุปัญหา; การ์ดปัญหาเปิดคิวที่กรองแล้ว; no-data/error ไม่ใช้ข้อความเดียว |
| รายบริษัท | `/system/partners/:companyId?tab=billing` | C01 summary/timeline; tab existing partner เก็บ route/query; company switch ล้าง selection/preview/pending action ของบริษัทเก่า |
| คิวปัญหา | `/system/billing/issues` และ `/:issueId` | C02 owner/status/reference และ action ที่อนุญาต; กลับคิวด้วย filter/cursor เดิม |
| คำสั่ง | `/system/billing/operations/:operationId` | desired/observed state, target company, initiator/approver, progress/retry/error; refresh/login/browser back อ่าน operation เดิม |
| ตั้งค่าและประวัติ | `/system/billing/settings?section=…` | C04–C08 permissions, policy, gates, reconcile และ audit; Draft/Review/Active/Failed แยกชัด |

ทุกหน้าระบุ **TEST/LIVE + บริษัท/ขอบเขต** ตลอด. Deep link ผ่าน login, refresh, change-password, legal ต้องคืน exact safe path/query เดิม; ใช้ request-path header ที่ proxy สร้าง ไม่เชื่อ header จากผู้เรียก. ขาดสิทธิ์: back/list/request access ผ่าน support ที่กำหนด; ไม่โชว์ข้อมูลบริษัทหรือการเงินก่อน authorize. Outage: retry/reference/status support; ไม่ login-loop.

UI ขั้นต่ำ: 390px/desktop, keyboard และ focus error, field labels, status aria-live, pagination, skeleton/empty/partial/error states, timestamps Bangkok พร้อม UTC ใน diagnostic ที่จำเป็น. “ไม่พบ” ต่างจาก “โหลดไม่ได้”; failure ห้ามแสดงยอด 0/ไม่มีหนี้โดยเดา.

## 3. Controls C01–C08

### C01 — ภาพรวมและ timeline รายบริษัท

อ่าน BillingAccount/Attempt/Invoice + CompanyPlanTerm/entitlements/holds + notification projection ที่มี provenance. แสดง payment, apply, access, subscription, document แยกแกน; current plan/usage/reset, paid-through, next collection/cancel-effective, amount/currency และ origin web/LINE. Billing แยกจาก ERP invoice ของลูกค้า.

Timeline ใช้ existing partner timeline/audit query pattern รวม events ด้วย reference, ไม่ copy raw provider log มาทั้งชุด. ระบุเวลาที่เกิด/เวลาที่ระบบได้รับ/observedAt เพื่อเห็น delayed events. Stale/outage แสดง last-known state พร้อมเวลาและปุ่ม refresh; ไม่เสนอ collection จากข้อมูลเก่า. Linked invoice/issue/operation เปิด tenant/account เดิมและตรวจสิทธิ์ใหม่ทุกครั้ง. ข้อมูลจำนวนมากใช้ cursor stable; ไม่ซ่อนรายการเกิน limit โดยไม่มี next page.

### C02 — คิวปัญหาและคนรับผิดชอบ

ชนิด: paid-not-applied, unknown attempt, provider event unmapped, subscription duplicate, invoice/document failure, notification failure, financial mismatch, config drift, permission/approval blocked. Priority/age จากผลกระทบ, ไม่ส่ง alert ทุก retry.

State: OPEN → ASSIGNED → IN_PROGRESS → WAITING_PROVIDER / WAITING_APPROVAL / WAITING_CUSTOMER → VERIFYING → RESOLVED. Reopen เมื่อ invariant เดิมเสียอีก; dedupe `(account, company, issueKind, businessReference)` และเก็บ episode. มี assignee + backup/escalation team; ไม่มีคนว่างต้องอยู่ใน unassigned queue และ escalation ที่กำหนด ไม่หายเพราะส่งแจ้งเตือนไม่ได้.

กด resolve ต้องอ้าง observed evidence ว่าปัญหานั้นหายแล้ว หรือระบุ disposition ที่ได้รับอนุญาต เช่น duplicate/accepted exception + expiry. ปิด support ticket ไม่เท่ากับ payment/apply สำเร็จ. Assignment/comment ใช้ expectedVersion; คนที่รับงานถูกถอนสิทธิ์ให้ reassignment โดยไม่คืนสิทธิ์อัตโนมัติ.

### C03 — ปุ่มแก้ปัญหาที่ไม่สร้างผลซ้ำ

Action allowlist: reconcile attempt/invoice, retry paid apply เดิม, resume approved command, retry notification delivery เดิม, request/record support outcome. ไม่เปิดรับ arbitrary URL, provider ID, payload, SQL หรือ event replay ข้าม account/company.

- ก่อน execute: แสดงบริษัท/env/operation type/เหตุผล/current vs desired/affected records และผลต่อเงิน/สิทธิ์/การแจ้งเตือน. Preview มี id/version/expiry; target เปลี่ยน, source/permission/policy เปลี่ยน → preview stale ให้ review ใหม่.
- ทุก mutation ใช้ durable command + Idempotency-Key + payload hash + expectedVersion. Double-click, สองคนกด, response หาย, refresh, session expiry ต้องค้น operation เดิมจาก server ได้. ห้ามสร้าง key ใหม่เพื่อ “ลองอีกครั้ง” กับ UNKNOWN.
- ถ้า lease ค้าง มี reclaim ที่มี fencing และ retry cap; terminal failure มี case + authorized retry/reconcile ไม่ทิ้งให้ developerลบ DB row. Retry apply ของ invoice เดิมไม่เพิ่มเดือน/สร้าง invoice/charge ใหม่.
- Replay financial operation ต้อง reauthorize ทั้งผู้กดและตัว operation. Access ถูกถอนระหว่าง queue/approval/execute ให้ BLOCKED ไม่ใช้ permission snapshot เก่าเป็นสิทธิ์ถาวร.
- Resend จำกัด recipient current identity/preferences/1:1; ไม่ใช้ client raw message เพื่อปลอม receipt. Notification ไม่ตัดสิน access. ถ้าส่งภายนอกสำเร็จแต่ response หาย ใช้ provider delivery reference/idempotency ที่รองรับและแสดง UNKNOWN; ไม่อ้าง exactly-once เมื่อ provider ไม่รับประกัน.

### C04 — สิทธิ์ Support / Finance / Operations / ผู้ดูแลนโยบาย

Reuse RBAC/permission catalog; ต่อไปนี้เป็น **capability bundles** ไม่บังคับสร้าง 4 roles ใหม่. Existing `/system` shell ปัจจุบันรับ SYSTEM_ADMIN เท่านั้น; ต้องปรับ shell/menu/BFF/API ไปตาม grants ที่ตรวจแล้วก่อนให้ delegated operators เข้า และห้ามเปิดทั้ง `/system` เพราะมี billing.read เพียงตัวเดียว.

| Capability เป้าหมาย | Support | Finance | Operations | Policy admin |
|---|---|---|---|---|
| `system.billing.read` / issue.manage | ข้อมูลขั้นต่ำ/เคส | ได้ตาม scope | ได้ตาม scope | ได้ตาม scope |
| financial detail/documents | ไม่ได้โดยปริยาย | grant เฉพาะ | masked default | grant เฉพาะ |
| reconcile / apply.retry | ดูผล/ร้องขอ | reconcile ตาม grant | ตาม grant | ไม่ได้โดยปริยาย |
| refund / collection.change | ขอให้ Finance ดำเนินการ | ตาม policy/วงเงิน/approval | ไม่ได้โดยปริยาย | ไม่ได้โดยปริยาย |
| policy/gate/override propose | ไม่ได้โดยปริยาย | ตาม grant | emergency stop ตาม grant | ตาม grant |
| approve high-impact command | grant แยก, ผู้ขออนุมัติตัวเองไม่ได้ | grant แยก | grant แยก | grant แยก |

ต้องกำหนด exact keys ใน shared catalog + seeds/migrations + route/action map ก่อน consumer. Backend ตรวจ actor, platform scope, company/cohort scope, amount/currency limit และ role revision. Customer OWNER ไม่เป็น platform Finance/Admin. Export และเอกสารมี permission แยกจากดู summary. Privileged operations ต้องใช้ auth/step-up mechanism ที่มีจริง; หากยังไม่มีให้คง action ปิดพร้อม workflowผู้รับผิดชอบ ไม่แสดงว่าผ่าน MFA แล้ว.

Exact **target** keys ใน namespace `system.billing` (ยังไม่อยู่ใน runtime catalog): `read`, `financial.read`, `document.read`, `issue.manage`, `reconcile.run`, `apply.retry`, `notification.retry`, `policy.manage`, `gate.manage`, `collection.manage`, `refund.manage`, `override.manage`, `approval.approve`, `audit.read`, `export`. เช่น keyเต็ม `system.billing.apply.retry`. แต่ละ key ตรวจ company/account/mode/cohort scopeซ้ำ; capabilitybundle ไม่ใช่การgrantทั้งหมดโดยอัตโนมัติ. `approval.approve` ไม่ให้สิทธิ์สร้างหรือexecuteงานอื่น; serviceexecutorต้องตรวจcommand grant/approval/currentpolicyด้วย.

### C05 — นโยบายและราคาแบบมีเวอร์ชัน

กรอกเฉพาะ schema allowlist: trial conversion rule, quota/reset/limits, grace rule, cancellation, plan-change/proration, refund/debt, tax/document settings และ approved offer→Price mapping. B01–B10 ยังใช้มติจริง ไม่ถือคำสั่งให้ทำ UI เป็นการเลือกระยะ grace/ภาษี/วงเงิน.

Lifecycle DRAFT → VALIDATED → REVIEW_REQUIRED → APPROVED → SCHEDULED → APPLYING → ACTIVE; conflict/failure → BLOCKED/PARTIAL_FAILED พร้อม corrective action. เก็บ effectiveAt, timezone, approvedBy, reason, source revision, customer cohort และ grandfathering rule. ใช้ version immutable; แก้ฉบับ active ต้องสร้างฉบับใหม่. Published price ใหม่ไม่ rewrite old invoices/subscriptions โดยเงียบ.

Impact preview แสดงจำนวนบริษัท/รายชื่อแบบ paginated, ราคา/สิทธิ์ก่อนหลัง, วันที่ตัดรอบที่กระทบ, over-limit branches/users, invoices/subscriptions ที่กำลังทำงาน และ consent/customer communication ที่ต้องมี. Execute ต้อง revalidate scope/revision; cohort เปลี่ยนเกิน preview ให้หยุดและ reviewใหม่. Rollback คือ compensating revision/command ตาม observed provider state ไม่ใช่ย้าย pointerกลับแล้วสมมติย้อนการเรียกเก็บที่ผ่านมาได้.

Marketing/app/LINE cards/worker อ่าน published catalog/projection เดียวกัน. Static mangmee_web bundle ปัจจุบันยังฝังค่า: ต้องเปลี่ยน consumer มาอ่าน public non-sensitive catalog + cache policyก่อนเรียก C05 no-deploy ผ่านทั้งสอง repo. Catalog stale/outage ปิดซื้อใหม่และแสดงเวลา/ทางติดต่อ; ใช้ approved cached copyเพื่ออ่านได้ตามอายุที่กำหนด แต่ไม่ใช้ authorize ราคาเก่า.

Target public contract `GET /v1/billing/catalog`: `{ catalogRevision, effectiveAt, validUntil, currency, taxDisplayMode, offers: [{ offerKey, title, priceSatang, interval, intervalCount, featureSnapshotVersion, limits, availability, reasonCode }] }`. คืนเฉพาะpublished publicoffersและapproved displaypolicy; ไม่คืนStripePrice/Customer IDs, internaldraft, company/financialrecordsหรือsecrets. Anonymouscache/ETagตามvalidUntilและboundedTTL; invalidationconsumerต้องผ่านCT19ใน30วินาที. Appcompanysummaryเพิ่มeligibilityตามauthscope; publicavailabilityไม่authorizeซื้อ. `mangmee_web` fetchจากAPIoriginที่allowlist/CORSไว้ ไม่ใส่session/credentialsและไม่ต้องbuildเพื่อเปลี่ยนoffer. APIจ่ายเงินจริงresolvePriceจากservermappingทุกครั้ง.

Catalog variant key คือ `(offerKey, interval, catalogRevision)`; interval month/year (trial null), count1. C05/C06 ต้อง validate mapping ทั้งสองรอบตาม [package spec §5–6](mangmee-package-entitlements-spec-th.md); Enterprise lock แยกจาก generic sales-enable และมี provider/Portal/stale-session drift recovery.

### C06 — สวิตช์เหตุขัดข้องและการเปิดทีละกลุ่ม

แยก flags ตาม action: new_sales, plan_changes, portal_actions (แต่ละ action), notification_delivery, company/cohort eligibility. Mode DISABLED/TEST/LIVE มีเพดานจาก deployment/environment config; UI ห้ามเปลี่ยน test account เป็น live หรือ override platform security hold.

- “หยุดขายใหม่” ไม่ปิด ingress/reconcile/paid apply/history/recovery/support ที่จำเป็น และไม่แปลว่าหยุด recurring collection.
- Pause/cancel collection เป็น provider command แยก ต้อง preview subscription scope, resumeAt และ invoice behavior; invoices เดิมที่ยัง collect ได้อยู่ในผลกระทบ. ไม่ออกปุ่ม blanket pause/refund/cancel ทุกบริษัทแบบไม่มีขอบเขต.
- Emergency stop มี auditทันทีและตามด้วย review; การเปิดกลับต้องตรวจ health, pending operations, policy and provider observed configuration. ห้าม schedule resume แบบมองไม่เห็น; แสดงเวลาและกลุ่มที่กลับมาเปิด.
- Reconcile worker outage/DB outage: new financial mutations fail closed; UI อธิบาย pending/สถานะล่าสุดพร้อม incident reference. ไม่ปิดทั้งระบบลูกค้าเพื่อหยุดเฉพาะ checkout.
- ใช้ existing feature-launch/command patterns เท่าที่ semanticallyตรง; ห้ามใช้ P27 ERP feature gate แทน billing collection state หรือรวมกับ platform customer OPEN/CLOSED gate.

Gate barrier มี sequence/revision: หลัง stopเป็นobservedACTIVE ไม่เริ่มfinancialcommandใหม่ที่ยังไม่ผ่านbarrier; commandที่เริ่มproviderrequestไปแล้วแสดงin-flightscopeและตามผลต่อ ไม่สัญญาย้อนrequestที่ส่งไปแล้ว. Bulkrolloutใช้explicitcohortsnapshot+per-itemversion; changingfilterในUIไม่เปลี่ยนงานที่approvedไปแล้ว.

### C07 — กระทบยอดและตรวจความต่างของ config

งานตรวจ bidirectional: provider→local และ local→provider; ตรวจ account/mode/customer/subscription/invoice/paid period/entitlement/holds/documents. แยก gross/tax/fee/refund/net/payout; settlement delay ไม่เป็น unpaid. Reuse billing reconciler, durable pagination cursor/overlap window/lease; run historyแสดงcoverage, checkpoint, skipped/unavailable.

Daily scheduled run และ on-demand scoped run ผ่านเว็บ. Large scan/bulk repair เป็น async operation, จำกัด concurrency/rate และprogress ต่อรายการ. Provider 429 เคารพRetry-After; partial failureต้อง retryเฉพาะส่วนที่เหลือ ไม่เริ่มทั้งชุดใหม่แล้ว applyซ้ำ. ไม่มี resultไม่เท่ากับ “ตรงทั้งหมด”. Exportถ้ารองรับต้อง permission, redaction และ auditแยก.

Config drift เปรียบเทียบ approved revision กับ Stripe/LINE/Postmark ที่อ่านผ่าน API ได้จริง. สิ่งที่ provider APIอ่านไม่ได้ต้องเป็น manual-verification-required มีผู้รับผิดชอบ/วันที่/หลักฐาน; ไม่ใส่ PASSสมมติ. การแก้ตรง Stripe Dashboardต้องถูกตรวจพบและสร้างissue; ไม่มีการautoเขียนทับ human cancellation/refund/customer adjustment โดยไม่ review.

LINEcredentialปัจจุบันมีknownsplitระหว่างDBsaveกับwebhooksecretconsumerตามSystemHeader/SharedLineSettings; ก่อนเปิดwebrotation ต้องให้verifier/reply/push/LIFFloginconsumerอ่านsecretproviderrevisionที่เปลี่ยนได้จริงพร้อมcacheinvalidationและrotationtest. ห้ามเปิดหน้าที่ซ่อนไว้เพียงเพราะsaveDBได้. Richmenuactionใช้stableentrypurposeและservercatalog/gate; cachedmenuเก่าต้องยังได้status/support. เปลี่ยนpublishedmenuversionผ่านprovidercommandพร้อมobservedmenuIdเมื่อรองรับ; งานออกแบบasset/purposeชนิดใหม่ยังต้องreleaseตามinitialimplementationboundary.

### C08 — Audit, approval และสิทธิ์ชั่วคราว

ทุก mutation เก็บ actor/approver, company/account mode, command/request/reference, reason/case, before/desired/observed after, versions, timestamps และผล. Audit append-only, ห้ามลบ errorเพื่อให้คิวสะอาด; secrets/บัตร/full provider payloadไม่อยู่ใน general audit/export.

Approval บังคับกับ operation categories ที่กำหนดว่า high-impact; configurable monetary/cohort thresholds ต้องมี approved valuesก่อนเปิด. Approval ผูก payloadHash/preview/source version และ expiry. ผู้อนุมัติเป็นผู้ขอ/สิทธิ์ถูกถอน/targetเปลี่ยน/หมดอายุ → ไม่ execute, มีทางขอ review ใหม่. No approver ต้องมี fallback assignment/supportและสถานะรอ ไม่ auto-approve.

Temporary override แยกจาก paid entitlement: scope/features/limit/accessUntil/reason/case/approver, immutable history. ต้องมี expiry enforcement ที่ read/admission time และ sweep/reconcileสำรอง ไม่พึ่ง cronครั้งเดียว. หมดอายุคืน baselineล่าสุดจาก paid/policy state ไม่คืน snapshotเก่าที่อาจทับ subscriptionใหม่. การถอน/หมดอายุไม่ลบข้อมูล; over-limit ให้ลดการเพิ่มข้อมูลใหม่ตามpolicy. Admin/security holdยังชนะoverrideยกเว้น explicit lifecycle permission/workflowที่แยกต่างหาก.

## 4. ข้อมูลและ backend contracts

Reuse BillingAccount/Attempt/Invoice/Event และ Outbox/Audit/partner timeline ใน owned spec. เพิ่ม logical records เท่าที่ schemaเดิมไม่รองรับ: **BillingControlRevision**, **BillingControlOperation**, **BillingIssue**, **BillingOverride**. Approvalอาจอยู่ใน operation + append-only audit ไม่ต้องมี engineอนุมัติทั่วไปใหม่.

- Revision: unique(account,mode,scope,version), schemaVersion, payloadHash, effectiveAt, lifecycle, approval/provenance.
- Operation: opaque id, commandType, intentId, company/cohort scope, idempotencyKey/requestHash, expectedVersion, preview, status, actor/approval, lease/fence/retryAt, desired/observed revisions, per-item outcomes. Unique(account,mode,idempotencyKey); same key/different payload →409.
- Issue: dedupe key + episode, affected references, assignee, version/state, evidence/resolution reason; reopen audit.
- Override: scoped immutable grant, startsAt/expiresAt/revokedAt, reason/approval/source; reads derive effective value with latest baseline.

Target API prefix `/v1/system/billing`; exact DTOs go to `packages/contracts` before implementation. Existing partner read/plan-term/timeline routes stay authoritative for fields they own.

| Method + resource | Contract / permission / recovery |
|---|---|
| GET `/overview`, `/companies/:id`, `/issues`, `/issues/:id` | scoped read, cursor/filter, observedAt/version, capabilities/reasons; no hidden financial data in non-Finance payload |
| PATCH `/issues/:id` | assign/comment/transition allowlist + expectedVersion; conflict returns refresh/review, not overwrite |
| POST `/operations/preview` | type + company/cohort/reference + proposed values + reason; server resolves provider ids/URLs; previewHash/version/expiry/impact |
| POST `/operations` | previewId/version, Idempotency-Key; 202 operationId/statusUrl; stale 409, missingapproval/permission explicit denial |
| GET `/operations/:id`, `/operations?companyId=…&status=…` | durable recovery after refresh/new device; queued/running/unknown/blocked/success/partial/failed + allowedActions |
| POST `/operations/:id/approve`, `/retry`, `/cancel` | separate permission and version; cancel only unexecuted work or supported compensating action. Existing successful provider side effect cannot be undone by canceling local job |
| GET/POST `/policies`, GET `/policies/:id` | read/draft schema only; publishing/scheduling/rollback through preview+operation, not unchecked PUT |
| GET `/gates`, `/reconciliation/runs`, `/audit`, `/overrides` | policy-aware read; changes/run/override use same operation boundary; no ad hoc bypass endpoint |

Errors reuse generic401/403/404/429/503 and add shared stable codes CONTROL_PREVIEW_STALE, CONTROL_APPROVAL_REQUIRED, CONTROL_OPERATION_IN_PROGRESS, CONTROL_POLICY_NOT_READY, CONTROL_OBSERVED_MISMATCH. Same code must have a Thai next action. 404สำหรับout-of-scope entityไม่บอกรายละเอียด; 401เก็บsafe next; 429แสดงเวลาretry; 503status/support. Local operation idไม่เป็นauthorization.

### 4.1 Command types / transitions สำหรับ shared DTO

`type` เป็น discriminatedunion: `RECONCILE` (attempt/invoice/company/run), `RETRY_APPLY`, `RETRY_NOTIFICATION`, `PUBLISH_POLICY`, `SET_ACTION_GATE`, `CHANGE_COLLECTION`, `EXPIRE_CHECKOUT`, `REFUND`, `GRANT_OVERRIDE`, `REVOKE_OVERRIDE`. ไม่มีarbitraryprovideraction. `REFUND`/`CHANGE_COLLECTION` ปิดพร้อมpolicyreasonจนB07/B08และrelatedpoliciesอนุมัติ; เปิดแล้วต้องrecordproviderobject/amount/currency/statusและอ่านผลผ่านreconcile ไม่ทำเครื่องหมายpaid/expiredจากrefundrequestอย่างเดียว. Record supportoutcomeใช้issue command ไม่ใช้refund.

Previewrequest: `{type, scope:BillingControlScope, referenceId?, proposed, reason, expectedVersion}`. Response: `{previewId, previewHash, expiresAt, sourceVersions, affectedCount, impactItemsCursor, requiredApprovals, warnings, allowedActions}`; backendderiveaccount/providerids. Submitbody `{previewId, previewHash, expectedVersion}` + `Idempotency-Key`; return `{operationId,status,statusUrl,version,desiredRevision,observedRevision?,retryAt?,allowedActions,reasonCode?}`. การแสดงamountใช้integer minorunits+currency; servervalidatecurrencyและpaidperiod ไม่รับUIคำนวณgrant.

เมื่อresponseหาย: authorizeก่อน แล้วlookupexistingcommandด้วยidempotencykey+payloadhashก่อนตรวจpreviewexpiryสำหรับการสร้างใหม่; matchคืนoperationเดิมโดยไม่executeซ้ำ แม้previewหมดอายุแล้ว. `GET /operations` รองรับcompanyId/type/status/intentIdแบบscopedเพื่อกลับจากnewdevice; UIให้เลือกงานเดิมพร้อมreference แทนคาดเดาว่าไม่พบidในbrowserแปลว่าไม่เคยส่ง. ห้ามอายุproviderkeyหมดแล้วลบbusinessdedupeและretryเป็นnewcharge.

Canonical operationstatuses: `AWAITING_APPROVAL → QUEUED → RUNNING → SUCCEEDED`; ระหว่างทำไป `RETRY_SCHEDULED`, `UNKNOWN`, `BLOCKED`, `PARTIAL_FAILED`, `FAILED` ได้ตามหลักฐาน. `UNKNOWN` ต้องreconcileก่อนเลือกretry/terminal ไม่autoเปลี่ยนFAILEDเพราะtimeout. `RETRY_SCHEDULED→QUEUED` เมื่อdue+authorized; `BLOCKED→QUEUED` หลังแก้เหตุและreviewใหม่ตามversion; `PARTIAL_FAILED` retryเฉพาะunfinisheditems. `CANCELLED` ได้เฉพาะก่อนsideeffectหรือcommandที่รองรับจริง; SUCCEEDEDimmutable. แก้ผลสำเร็จด้วยlinkedcompensatingcommandใหม่ที่preview/approveใหม่. เก็บtransitionbefore/afterในaudit.

IssueUIpollและoperationpoll reuse boundedstatuspolicyในcustomerUI (หยุดเมื่อhidden/offline/terminal, มีmanualrefreshหลังครบ2นาที); workerไม่หยุดเพราะUIหยุดpoll. Draftไม่มีsecrets; sessionstorageเก็บได้เฉพาะopaqueoperation/reference แต่serverlookupเป็นแหล่งกู้หลังnewdevice. Delete/retentionต้องเก็บbusinessidempotencytombstoneให้นานพอป้องกันreapply ไม่พึ่งproviderkeyretentionเพียงอย่างเดียว.

### 4.2 UI wireframes ที่ developer ใช้ต่อได้

```text
/system/billing                     [TEST] [บริษัท/สถานะ/อายุปัญหา] [ค้นหา]
  จ่ายแล้วรอเปิดใช้  | รอตรวจผล | เคสไม่มีผู้รับ | Config ไม่ตรง
  บริษัท | payment | apply | access | observedAt | [เปิดรายละเอียด]
  [ก่อนหน้า/ถัดไป]   โหลดไม่ได้: [ลองใหม่] [สถานะบริการ/ติดต่อ]

/system/partners/:id?tab=billing     [กลับคิวเดิม] [TEST] บริษัท A
  แพ็กเกจ / usage / paid-through / next collection / hold
  [ประวัติเงินและสิทธิ์] [เอกสาร] [เคสที่เกี่ยวข้อง]
  Invoice X: PAID · APPLY_PENDING · ACCESS_EXPIRED
  [ตรวจสถานะล่าสุด] [ดูคำสั่งเดิม] [ขอให้ผู้มีสิทธิ์แก้]

/system/billing/operations/:id      [กลับบริษัท] [TEST] #operation
  ผู้ขอ / ผู้อนุมัติ / เหตุผล / before→desired / จำนวนบริษัท
  Preview: [แก้ร่าง] [ยืนยันส่งคำสั่ง] หรือ [ส่งขออนุมัติ]
  รออนุมัติ: ผู้รับงาน / expiresAt / [ดูเคส] [ถอนคำขอถ้าทำได้]
  กำลังทำ/ผลไม่ชัด: retryAt / observedAt / [อ่านผลใหม่] [กลับภายหลัง]
  ล้มบางรายการ: แต่ละรายการ+reason / [ทบทวนแล้วลองเฉพาะที่เหลือ]

/system/billing/settings            [TEST] [Policy|Gates|Reconcile|Overrides|Audit]
  Active revision + observed revision + pending operations
  [สร้างร่าง] → schema fields → [ดูผลกระทบ] → approval → status URL
  Gates: new sales / plan changes / portal action / notification / cohort
  Collection: separate preview+scope+invoice behavior+resumeAt
  Audit: actor/action/company/reason/reference/time + [เปิดคำสั่ง]
```

Issue detailแสดงowner/status/age/evidenceและactionmenuตามcapabilities พร้อม[กลับคิว]และ[เปิดบริษัท]. Mobileแสดงsummarycardsแทนบังคับwidefinancialtable; modalconfirmationต้องfocus/keyboardและไม่ทับsafeexit. ข้อความcustomerใช้ธุรกิจที่เข้าใจได้ เช่น “รับชำระแล้ว กำลังเปิดใช้งาน”/“บัญชีอยู่ระหว่างตรวจสอบ ติดต่อเจ้าหน้าที่พร้อมเลขอ้างอิง”; providererror/workerleaseไม่อยู่ในflowลูกค้า.

## 5. No-dead-end state/action matrix

| State | ทางที่ต้องมีในเว็บ | สิ่งที่ห้ามเกิด |
|---|---|---|
| Loading/read failed/partial | retry same read, last-observed time, back/list; pending action linkยังอยู่ | show0/success, spinnerไม่มีจุดจบ |
| Validation/stale preview | field error/focus หรือ refresh+review preserving safe draft | executeกับpayload/บริษัทเก่า |
| Awaiting approval | assignee/expiry/request review/back | ให้ผู้ขอข้ามapproval หรือรอโดยไม่รู้ใครรับผิดชอบ |
| Queued/running/unknown | stable status URL, refresh/back, same-operation retryเมื่ออนุญาต, case reference | submitใหม่ด้วยkeyใหม่เพราะresponseหาย |
| Provider unavailable/rate limited | queued retryAt, scopedmanual retryหลังเวลา, incident/support | discard paid evidenceหรือgrantจากtimeout |
| Partial batch | per-itemresults, retryfailedonly, exportตามสิทธิ์ | green successทั้งชุด/rollbackmoneyที่เกิดแล้วโดยเดา |
| Paid but held | paid evidence + hold reasonตามสิทธิ์ + lifecycle/support route | repayCTA หรือauto-unhold |
| Unauthorized/revoked/missing | safe company/list/account switch/requestaccess path | ใช้directAPIหรือoldbrowserstateข้ามrole |
| Override expiry/cancel effective | effective stateจากserver + renewal/support route | deleteข้อมูล/คืนbaselineเก่าหรือtrialใหม่ |
| Notification failed/no LINE/email | in-app stateยังอ่านได้, contact/recipient-fixตามสิทธิ์, retrydeliveryเดิม | ถอนสิทธิ์เพราะส่งข้อความไม่ได้ |
| Policy/gate/provider configไม่พร้อม | บอกsettingที่ขาดสำหรับoperator + go-to-settingหรือassignedcase; customerเห็นavailability+support | ปุ่มไม่มีhandler/ไม่อธิบายblockedreason |

ทุกปุ่มมี action contract หรือdisabled reason + authorized next step. ทุก operation มี status URL หลังbrowserปิด. การออกไป Stripe/LINE/Postmark Dashboard ต้องระบุเหตุผล/targetและกลับwebอ่านผลใหม่; routine actionsที่ provider APIรองรับต้องอยู่ในเว็บเมื่อครบslice. ไม่ทำUIครอบ provider featureที่ยังไม่มี APIหรือทดสอบไม่ได้แล้วอ้างว่าno-deployครบ.

## 6. Security และการทดสอบโดยไม่ deploy

Local E2E ใช้ browser→BFF→API→PostgreSQL→worker จริง. ตั้ง fixture/clock/fault ที่ provider boundary; ห้าม mockcontrolAPIให้ตอบsuccessแล้วเรียกcontrolintegrationผ่าน. จำลอง Stripe/LINE/Postmarkเฉพาะ adapter/SDK โดยให้เก็บ outbound attemptsและยืนยันไม่มีexternaldeliveryจริง.

Proof no-deploy: บันทึกprocess identity/startup config/revisionก่อนทดสอบ; adminเปลี่ยนsettingผ่านUI; เปิดcustomerwebอีกcontextและLINE bridgeเพื่ออ่านผล; worker/API/providerfixtureต้องackrevisionเดียวกัน; หลังเปลี่ยน/ย้อนกลับ process identityเหมือนเดิม ไม่มีrestart/build/deploy/scriptแก้DBระหว่างuserflow. DB directใช้setup/cleanupและread-only assertionsเท่านั้น.

Provider signed-webhook/parserต้องมีintegrationtestของadapterแยก; nativeLINE/3DS/เงินจริงต้องใช้sandbox/device evidenceตามแผนเดิม. Browserจำลองผ่านlocalได้โดยไม่deploy แต่ไม่ยืนยันnative LINEหรือStripeจริงจากmock.

## 7. Developer handoff — ข้อกำหนดที่ห้ามปล่อยให้แต่ละทีมตีความต่างกัน

ส่วนนี้ขยาย §2–6 หลังตรวจจากมุมคนเริ่ม implementation. เป็น target design; ไม่เปลี่ยนสถานะ runtime/test เป็น PASS.

### 7.1 Billing-only operators และแหล่งข้อมูล

- เพิ่ม target `/system/billing/companies/:companyId` สำหรับผู้มี `system.billing.read` ตาม scope. หน้า `/system/partners/:companyId?tab=billing` เดิมยังเป็น entry ของผู้มี partner permissions; reuse billing view ภายในได้ แต่ห้ามให้ billing-only user ต้องเปิด editor/เรียก APIs ทั้ง PartnerDetailPage เพื่อดูบิล.
- `/system` shell ตรวจว่ามีสิทธิ์เข้าอย่างน้อยหนึ่ง section; child route/BFF/API ต้องตรวจ exact permission อีกครั้ง. Billing grant ไม่ให้เข้าหน้า platform access, company onboarding, employee credentials, AI budget หรือ partner metadata ที่ไม่ได้รับสิทธิ์. Direct URL ต้องได้ผลเดียวกับเมนู.
- Billing read projection คืนข้อมูลต่ำสุดตาม capability; links, filtered counts, CSV/export และ issue descriptions ต้องใช้ scope เดียวกัน. Partial financial denial ไม่คืน field ใน JSON แล้วเพียงซ่อน CSS. การอ่าน payment status ขั้นต่ำไม่ให้สิทธิ์เปิดเอกสาร.
- Source ของ paid/apply คือ BillingInvoice/Account; CompanyPlanTerm เป็น applied access projection; manual term grant/override มี provenance แยก. ไม่มีการอนุมาน paid จากชื่อ tier, admin approval หรือ session redirect.

### 7.2 Command payload และ identity

Scope เป็น tagged union เท่านั้น: `{kind:"COMPANY", companyId, mode}` หรือ `{kind:"COHORT", cohortId, mode}`; ห้ามส่งทั้งสองชนิดหรือ arbitrary company-id array. Server resolve provider account และ freeze cohort membership ใน preview; cohort ต้องเป็น account/mode เดียวกัน หากปะปนให้ reject ก่อนทำรายการ ไม่เลือก account แรกเอง. `mode` เป็น TEST/LIVE ภายใต้ environment ceiling; DISABLED เป็น gate state ไม่ใช่ Stripe account mode.

Preview สร้าง `intentId` ฝั่ง server และผูก initiator/scope/type/reference/normalized proposed hash. `previewId` เปลี่ยนได้เมื่อ review ใหม่; ถ้า intent ถูก submit แล้วต้องเปิด operation เดิม ไม่แก้ payloadใน intentนั้น. Operation เก็บ intentId และ unique(account, mode, intentId) เพิ่มจาก idempotency key. Clientส่ง opaque Idempotency-Key เดิมตลอด submit/transport retry; `X-Request-Id` เป็น diagnostic และไม่ใช้แทน business identity. BFF/401-refresh/CSRF-refresh ต้องส่งทั้ง key/body เดิมและไม่ auto-submit หลังข้าม legal gateโดยไม่รู้ว่าคำสั่งเดิมสำเร็จหรือยัง.

| Command | Required proposed / reference | Capability และเงื่อนไข |
|---|---|---|
| RECONCILE | `referenceId` เป็น local attempt/invoice/account; `proposed:{resourceType}` enum ATTEMPT/INVOICE/ACCOUNT; cohort ใช้ run scope ไม่มี arbitrary ID | reconcile.run; ดูผลอย่างเดียวไม่สร้าง charge |
| RETRY_APPLY | local invoiceId; `proposed:{}` | apply.retry; มี verified paid evidence และ reuse invoice/period apply identity |
| RETRY_NOTIFICATION | local deliveryId; `proposed:{}` | notification.retry; recheck current recipient/purpose/preferences; adapter policyกำหนด duplicate risk |
| PUBLISH_POLICY | draft revisionId; `proposed:{effectiveAt}` ISO UTC | policy.manage + approval ตาม policy; draft เป็น typed schemaVersion พร้อมมติ ไม่รับ raw script/Stripe payload |
| SET_ACTION_GATE | scope + `proposed:{action,enabled}`; action เป็น new_sales/plan_changes/portal_payment_method/portal_change_plan/portal_cancel_subscription/notification_delivery | gate.manage; เปลี่ยนแต่ละ action ผ่าน command แยก; ไม่มี side effect เปลี่ยน environment ceiling |
| EXPIRE_CHECKOUT | local attemptId; `proposed:{}` | gate.manage; explicit preview ของ open hosted Session; ไม่ cancel subscription/refund โดยปริยาย |
| CHANGE_COLLECTION | local accountId; `proposed:{action:"PAUSE"|"RESUME"|"CANCEL", collectionPolicyRevisionId, resumeAt?}` | collection.manage + approved policy; provider params/invoice behavior deriveจากrevision ไม่รับfreeform |
| REFUND | local invoice/payment reference; `proposed:{amountSatang,currency:"THB",refundPolicyRevisionId}` | refund.manage + approval/วงเงิน; positive integer และไม่เกินremaining refundableที่ยืนยันใหม่ |
| GRANT_OVERRIDE | company scope; `proposed:{overridePolicyRevisionId,startsAt,expiresAt,values}` | override.manage + approval; valuesเฉพาะ feature/limit keys ที่typedpolicyอนุญาต; expiryบังคับ |
| REVOKE_OVERRIDE | local overrideId; `proposed:{}` | override.manage; ไม่มีการลบaudit/ย้อนเงินจริง |

ทุก proposed object reject unknown keys. Customer actionต้องผ่านทั้ง environment ceiling, approved policy, company eligibility, actor permission, specific action gate และ compatible observed config; flagsไม่overrideกันแบบlast-write-wins. ปิดportal_change_planไม่ปิดportal_cancel_subscriptionหรือทางแก้บัตรโดยปริยาย. expectedVersion เป็น version ของ resource/scope ที่แก้; sourceVersions ใน preview เป็น server-captured versions ของ account/invoice/policy ที่อ่านร่วมกัน และ recheck ก่อน reserve/execute ไม่รับ client override. Policy business values เป็น allowlisted schemas แยกตาม B decision; ยังไม่อนุมัติให้คืน CONTROL_POLICY_NOT_READY พร้อม missingDecisionIds และ route ไป draft/case. ห้ามใช้ nullable valueเป็น 0 หรือ “ไม่จำกัด”. ก่อนเริ่ม consumer ต้อง commit shared DTO/parser/fixtures โดยใช้ตารางนี้และ schemaVersion; ไม่ส่ง `Record<string,any>` ข้าม boundary.

### 7.3 กันซ้ำแม้ใช้คนละ key / สองคนกด

Idempotency key กัน transport retry; ไม่พอสำหรับ operator สองคนที่สร้างคนละ intent. ใน transaction ให้ lock Company → BillingAccount → affected Invoice/operation ตามลำดับเดียว แล้วตรวจ expected source version และ active operation ของ resource/action. Conflictคืน existing operation reference เฉพาะคนที่อ่านได้ หรือ generic conflict+refresh; ไม่เผยข้อมูลงานนอก scope.

RETRY_APPLY ใช้ unique paid-period apply ของ invoice; REFUND ต้อง reserve amount/source version ใน durable operation ก่อน provider call เพื่อไม่ให้สองคำสั่งรวมเกินยอดหรือrefundซ้ำโดยไม่ตั้งใจ. PUBLISH_POLICY/SET_ACTION_GATE ใช้ scope revision CAS. RETRY_NOTIFICATION ใช้ delivery intent/generation เดิมตาม mail/LINE policy ไม่สัญญา exactly-once ภายนอก. ไม่ถือ DB lock ขณะเรียก provider; result เขียนด้วย fence/version. Replay key/hashเดิมอ่าน operationก่อน preview expiry แต่ต้อง authorizeอ่านผลทุกครั้ง.

### 7.4 ราคาที่เปลี่ยนและ hosted flow ที่ออกไปแล้ว

แบ่งอย่างชัดเจน: catalog ที่กำลังดู, quote ที่ยังไม่ใช้, provider Session ที่สร้างแล้ว, paid invoice. เปลี่ยน approved revision ทำให้ unsubmitted quoteต้อง reviewใหม่. ส่วน Session/Invoice ที่ serverสร้างจาก quote/consentซึ่งอนุมัติในขณะนั้นต้องเก็บ historical mapping/snapshot; การเลิกขาย Price ไม่ใช่เหตุลบหลักฐานหรือปฏิเสธ paid invoice เก่าโดยใช้ current catalogเพียงอย่างเดียว. การรับ service period/สิทธิ์ยึดสัญญาและ B01/B05/B08 ที่มีผลกับรายการนั้น พร้อม holdปัจจุบัน ไม่ใช้ราคา/สิทธิ์ใหม่แทนเงียบๆ.

ปุ่ม “หยุดออกลิงก์ขายใหม่” คุมการสร้าง Session ใหม่ในมั่งมี. Session ที่ออกไปแล้วอยู่ใน in-flight list; หากต้องหยุดให้ใช้ EXPIRE_CHECKOUT แยกและตรวจ observed provider state. Stripe ให้ expire Checkout Session ที่เป็น `open`; complete/expired หรือ race ต้อง reread/reconcile และไม่รายงานว่า cancel paymentสำเร็จจาก API error. [Stripe expire API](https://docs.stripe.com/api/checkout/sessions/expire)

Portal sessionต้องส่ง configuration ID ที่ผูกกับ approved policy/account/mode ทุกครั้ง ห้ามพึ่ง default configurationของDashboardโดยเงียบ เพราะ API ใช้ default เมื่อไม่ส่ง ID. [Stripe create Portal session](https://docs.stripe.com/api/customer_portal/sessions/create)

Application gate ของ portal actionคุมการออก session/flow ใหม่; **ไม่เป็นการรับรองว่า revoke session URL ที่ออกแล้วทันที**. แสดง affected issued-session/config scope และส่ง incident/reconcile ตามหลักฐาน. ผลต่อ sessionเก่าจากการเปลี่ยน provider configurationต้องพิสูจน์ใน sandboxก่อนกล่าวอ้าง. มีทางอัปเดตบัตร/ยกเลิก/ติดต่อเจ้าหน้าที่ตาม capabilityที่ยังอนุญาต; ห้ามปิด Portal ทั้งหมดจนลูกค้าที่มีสัญญาค้างไม่มีทางหยุดการต่ออายุ.

ถ้า provider complete/paid ชนะการ expire ให้ durable receipt/apply/reconcile ทำงานต่อ และคง outcomeจริงใน issue. Refund/compensationเป็นอีก approved command; ไม่สั่งคืนเงินอัตโนมัติเพียงเพราะ stop gateมาทีหลัง. UI `EXPIRE_CHECKOUT` ใช้คำว่า “ยุติหน้าชำระที่ยังไม่เสร็จ” ไม่ใช้ “คืนเงินแล้ว”.

### 7.5 Operator authorization ต่างจากงานอัตโนมัติที่ต้องทำให้จบ

- Operator command reauthorize ผู้ขอ/ผู้อนุมัติก่อนเริ่ม side effect และเมื่อจะretry mutation; ถูกถอนสิทธิ์ให้ BLOCKEDพร้อม reassignment/reviewใหม่ ไม่โอนผู้ริเริ่มให้คนอื่นด้วยการแก้ actorId.
- เมื่อ providerอาจทำแล้ว ต้องอ่าน/บันทึกผลโดย system reconciliation identityต่อได้ แม้ operator ถูกถอนสิทธิ์; ห้ามทิ้ง UNKNOWN และสร้างใหม่เพื่อเปลี่ยนผู้รับผิดชอบ. การขอ mutationเพิ่มต้องมีauthorizationใหม่.
- Automatic verified-paid apply, expiry enforcement, event ingestion และ reconciliation ใช้ service identity + approved business evidence/current company hold. ไม่บังคับว่า payerหรืออดีตpublisherต้องยังมีroleเดิมตลอดไปจึงจะจัดการใบที่จ่ายแล้วได้. ตรวจ current recipient/membershipก่อนอ่านผลหรือส่งเอกสารให้บุคคล.
- ACTIVE policy ที่อนุมัติและมีผลแล้วไม่หายจากการ offboard ผู้เผยแพร่. Pending approval/queued operation ใช้ current grants; เปลี่ยน activepolicyต้องมี revision/commandใหม่พร้อมaudit. Human grantไม่ใช่ service-worker bypass.

### 7.6 Readiness, local simulation และ restore

แสดง readiness ตาม action: missingDecisionIds, missingConfigKeys (ชื่อเท่านั้น), missingCapabilities/approver, providerMode/health และ blockedReason. “setupพร้อม” แยกจาก “policyอนุมัติ” และ “provider observedตรง”. UIมีassignedcase/หน้าsettingsที่เกี่ยวข้อง; consumerไม่เปิด featureเพราะ configที่ขาดถูกตีเป็นfalse/0.

Local fixture policyระบุ `TEST_ONLY`, account/mode/scope และมติสมมติใน testdata; production loaderต้อง reject TEST_ONLY revision. ใช้ช่วยพัฒนา flowโดยไม่เลือกค่าธุรกิจแทนOwner. Test suiteต้องตรวจ rejectionนี้ด้วย. API/parser/schema/newfeaturesยังต้องrelease; configurablevaluesที่รองรับใช้DBrevisionตามno-deploy contract.

Migration/restore ต้อง additive และรองรับ queued schemaVersionจากรุ่นก่อน. Unsupported versionเข้า BLOCKED_VERSIONพร้อม operator status/case ไม่ทิ้ง/ตีความfieldใหม่เอง. หลังrestoreเปิด ingress+read/reconcile ก่อน new financial mutations; เทียบ provider objectsกับintent/ledger/dedupeที่restoreกลับมาเพื่อไม่ charge/refund/applyซ้ำ. การคืน backupไม่ใช่ rollbackเงินที่providerทำระหว่างนั้น. Live recoveryยังต้องตามrunbookเดิม; ทดสอบทั้งหมดนี้ในlocalPG/adapterfixtureก่อน.
