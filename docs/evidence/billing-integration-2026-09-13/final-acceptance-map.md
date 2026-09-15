# Final CT/AP implementation and verification map

ขอบเขต:33กลุ่ม CT (รวม CT24a) และ24กลุ่ม AP รวม57กลุ่ม acceptance. ตารางนี้ผูกเส้นทางที่ implement กับหลักฐานจริง; จำนวนทดสอบย่อยทับซ้อนกันและไม่ใช่จำนวน business flow หรือเปอร์เซ็นต์.

สถานะ: final local verification ผ่านตาม [ผลปัจจุบัน](final-integration-result.json). แต่ละ JSON ระบุ source/คำสั่ง/ขอบเขตของ checkpoint; final-integration-result.json บันทึกผลชุดรวมและ focused final correction. Link ที่เป็น regression เป็นการตรวจ logic/contract/source ไม่ใช่คำกล่าวว่าเปิด browser ทุก permutation แล้ว. Simulation ใช้ Nest HTTP/PostgreSQL/Next/Chromium จริง และจำลอง Stripe/Postmark/LINE transport ตามที่ Owner อนุญาต.

| ID | เส้นทางและผลที่ต้องได้ | Implementation / evidence |
|---|---|---|
| CT01 | ภาพรวม → บริษัท → บิล → กลับตัวกรอง | [admin-company-browser](admin-company-browser-result.json), [history-export](history-export-result.json) |
| CT02 | บริษัทไม่มีบิล / ข้อมูลเก่า / โหลดล้ม → โหลดใหม่ | [admin-company-browser](admin-company-browser-result.json), [configuration-check](configuration-check-result.json) |
| CT03 | ค้นหา / หน้าถัดไป / เปลี่ยนบริษัทระหว่างอ่าน | [admin-company-browser](admin-company-browser-result.json), [history-export](history-export-result.json) |
| CT04 | session / password / legal gate → กลับบริษัทเดิม | [owner-ux](owner-ux-result.json), [scopes-browser](scopes-browser-result.json), [email-password-reset](email-password-reset-result.json) |
| CT05 | ปัญหาเดิม → มอบหมาย → ตรวจ → ปิด / เปิดรอบใหม่ | [cases-browser](cases-browser-result.json), [support-sla](support-sla-result.json) |
| CT06 | ผู้ดูแลแก้พร้อมกัน / ผู้รับงานเสียสิทธิ์ → conflict / ผู้สำรอง | [cases-combined](cases-combined-result.json), [support-sla](support-sla-result.json) |
| CT07 | แจ้งเตือนล้ม → คิวยังอยู่ / กู้ส่งจากต้นทาง | [delivery-recovery-browser](delivery-recovery-browser-result.json), [support-outcomes](support-outcomes-result.json) |
| CT08 | ตรวจผล → ส่งซ้ำคำขอเดิม → ผลครั้งเดียว | [paid-request](paid-request-result.json), [refund-command](refund-command-result.json), [plan-adjustments](plan-adjustments-result.json) |
| CT09 | provider รับแล้วคำตอบหาย → เปิดรายการเดิม → ตรวจผล | [checkout-observation](checkout-observation-result.json), [refund-command](refund-command-result.json) |
| CT10 | จ่ายแล้วแต่ apply ล้ม → worker กู้ต้นทาง | [apply-invoice](apply-invoice-result.json), [paid-request](paid-request-result.json) |
| CT11 | source / policy / permission เปลี่ยน → ปฏิเสธ / ตรวจใหม่ | [configuration-impact-browser](configuration-impact-browser-result.json), [refund-command](refund-command-result.json) |
| CT12 | ส่งแจ้งเตือนแล้วไม่ทราบผล → กู้ตามหลักฐานเดิม | [notification-retry-guard](notification-retry-guard-result.json), [delivery-recovery-browser](delivery-recovery-browser-result.json) |
| CT13 | ขอบเขตผู้ดูแลแต่ละหน้ากับ API | [scopes-http](scopes-http-result.json), [scopes-browser](scopes-browser-result.json) |
| CT14 | แก้ company/account/mode/id → ไม่อ่านหรือเขียนข้าม | [scopes-http](scopes-http-result.json), [provider-event](provider-event-result.json) |
| CT15 | ผู้ขออนุมัติเอง / สิทธิ์ถอน / proof หมด → กลับตรวจ | [scopes-browser](scopes-browser-result.json), [configuration-browser](configuration-browser-result.json), [plan-adjustments](plan-adjustments-result.json) |
| CT16 | ร่าง → ตรวจ → อนุมัติ → ตั้งเวลา → revision มีผล | [configuration-drafts-browser](configuration-drafts-browser-result.json), [scheduled-policy](scheduled-policy-result.json) |
| CT17 | ราคา / ใบเสร็จ / เพดานใหม่ → คงหลักฐานเก่า | [offer-terms](offer-terms-result.json), [capacity-policy](capacity-policy-result.json), [configuration-impact-browser](configuration-impact-browser-result.json) |
| CT18 | เผยแพร่พร้อมกัน / preview เก่า → มี revision เดียว | [configuration-browser](configuration-browser-result.json), [scheduled-policy](scheduled-policy-result.json) |
| CT19 | Admin เผยแพร่ → เว็บ/marketing/LINE อ่าน → คืนค่าผ่านเว็บ | [configuration-browser](configuration-browser-result.json), [offer-terms](offer-terms-result.json), [sales-cohort](sales-cohort-result.json) |
| CT20 | ปิดขายขณะ Checkout ค้าง → ยังตรวจเงินที่จ่ายแล้วได้ | [checkout-expiry](checkout-expiry-result.json), [checkout-observation](checkout-observation-result.json) |
| CT21 | ปิดเฉพาะ action / cohort / notification → มีทางกลับ | [sales-cohort](sales-cohort-result.json), [portal-consistency](portal-consistency-result.json), [notification-browser](notification-browser-result.json) |
| CT22 | พัก / เลื่อนวันกลับ / กลับเก็บ → คงบิลเก่า / ไม่ตัด draft เอง | [Final clean integration](final-integration-result.json) |
| CT23 | provider/worker ไม่พร้อม → pending/case → กู้ต่อ | [configuration-check](configuration-check-result.json), [provider-event](provider-event-result.json), [batch](batch-result.json) |
| CT24 | ค้น paid invoice ที่ขาดทั้งสองฝั่ง → map → ตรวจใหม่ | [provider-discovery](provider-discovery-result.json), [invoice-discovery](invoice-discovery-result.json), [invoice-import](invoice-import-result.json) |
| CT24a | event DEAD/RETRY เดิม → คำขอ → reconciler → ผลจริง | [provider-event](provider-event-result.json), [provider-event-browser](provider-event-browser-result.json) |
| CT25 | 429 / หน้าถัดไปล้ม / งานชุดย่อยค้าง → ทำต่อ | [batch](batch-result.json), [settlement](settlement-result.json), [provider-discovery](provider-discovery-result.json) |
| CT26 | refund/dispute/cancel ที่ provider → ต้นทางล่าสุดชนะ | [refund-controls](refund-controls-result.json), [refund-command](refund-command-result.json), [invoice-adjustments](invoice-adjustments-result.json) |
| CT27 | config drift / key rotation → readiness / กลับตรวจ | [configuration-check](configuration-check-result.json), [line-runtime-credentials](line-runtime-credentials-result.json), [email-monitoring](email-monitoring-result.json) |
| CT28 | สิทธิ์แถมหมด → baseline ล่าสุด / security hold ชนะ | [plan-adjustments](plan-adjustments-result.json), [Final clean integration](final-integration-result.json) |
| CT29 | ถอนสิทธิ์ก่อนทำงาน / audit ล้ม → ไม่เปลี่ยนสิทธิ์เงียบ | [plan-adjustments](plan-adjustments-result.json), [admin-receipt-adjustments](admin-receipt-adjustments-result.json), [Final clean integration](final-integration-result.json) |
| CT30 | ผลเงินบางส่วน → ตรวจต้นทาง / ชดเชยอย่างมีขอบเขต | [refund-command](refund-command-result.json), [settlement](settlement-result.json), [checkout-observation](checkout-observation-result.json) |
| CT31 | 390px / ปุ่มกำลังทำงาน / error / retry / กลับหน้าเดิม | [owner-ux](owner-ux-result.json), [admin-budget-input](admin-budget-input-result.json), [Final clean integration](final-integration-result.json) |
| CT32 | case → อนุมัติ → observed → ปิด → สิทธิ์เว็บ/LINE ล่าสุด | [cases-combined](cases-combined-result.json), [line-queued-billing-browser](line-queued-billing-browser-result.json), [Final clean integration](final-integration-result.json) |
| AP01 | Admin / delegated / Owner / employee ไม่มีการยกระดับ | [scopes-http](scopes-http-result.json), [scopes-browser](scopes-browser-result.json) |
| AP02 | preset เริ่มต้น17keys / ดูก่อนบันทึก / สิทธิ์ย่อย | [Feature browser](feature-controls-result.json) |
| AP03 | lost response คำขอเดิม / CAS / ไม่ทับผู้แก้รายอื่น | [Feature browser](feature-controls-result.json), [plan-adjustments](plan-adjustments-result.json) |
| AP04 | foundation / normalization / dependency / launch gate | [Feature browser](feature-controls-result.json) |
| AP05 | แพ็กเกจ / feature / role แยกกัน | [plan-adjustments](plan-adjustments-result.json), [admin-receipt-adjustments](admin-receipt-adjustments-result.json), [billing-label-offer-matrix](billing-label-offer-matrix-result.json) |
| AP06 | ปิดเมนู / เปิดคืน / งานเก่ายังเก็บตาม cutoff | [Entitlement/launch regression](../../../apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts) |
| AP07 | role / membership lifecycle / เจ้าของคนสุดท้าย | [Role/employee regression](../../../apps/api/src/modules/employee-access/application/use-cases/employee-lifecycle.use-case.spec.ts) |
| AP08 | เปลี่ยนสิทธิ์ใน process เดิม → เว็บ/LINE ใช้ค่าล่าสุด | [line-access](line-access-result.json), [receipt-quota-browser](receipt-quota-browser-result.json), [Feature browser](feature-controls-result.json) |
| AP09 | dashboard / drilldown / own / branch / tenant | [Dashboard/notification regression](../../../apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts) |
| AP10 | expense / receipt / evidence / signature / quota | [receipt-upload-source](receipt-upload-source-result.json), [signature-upload-access](signature-upload-access-result.json) |
| AP11 | ขอเบิก / ดู / อนุมัติ / การเงิน / source เดิม | [Reimbursement scope regression](../../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-branch-scope.use-case.spec.ts) |
| AP12 | สมาชิก / role / branch / seat concurrency | [capacity-policy](capacity-policy-result.json), [plan-adjustments](plan-adjustments-result.json), [Role/employee regression](../../../apps/api/src/modules/employee-access/application/use-cases/employee-lifecycle.use-case.spec.ts) |
| AP13 | company foundation / branch / security / scope | [manual-plan](manual-plan-result.json), [capacity-policy](capacity-policy-result.json), [email-password-reset](email-password-reset-result.json) |
| AP14 | notification recipient / deeplink / สิทธิ์ล่าสุด | [Dashboard/notification regression](../../../apps/api/src/modules/dashboard-notifications/dashboard-notification-correctness.spec.ts), [notification-browser](notification-browser-result.json) |
| AP15 | expired / held / applying / overlimit / 401/403/429 | [owner-ux](owner-ux-result.json), [downgrade-browser](downgrade-browser-result.json), [admin-budget-input](admin-budget-input-result.json) |
| AP16 | trial / paid12แบบ / Enterprise และ SYSTEM tax lock | [signup-journey](signup-journey-result.json), [billing-label-offer-matrix](billing-label-offer-matrix-result.json) |
| AP17 | AI help / follow-up เฉพาะที่ใช้ได้ / ไม่เรียกโมเดลเมื่อปิด | [ai-support](ai-support-result.json), [line-access](line-access-result.json) |
| AP18 | คุยทั่วไป / คำถามธุรกิจ / AIbudget แยก receipt | [ai-support](ai-support-result.json), [admin-ai-adjustments](admin-ai-adjustments-result.json) |
| AP19 | tool / tenant / scope / delegation ตรวจที่ API | [line-access](line-access-result.json), [line-source](line-source-result.json) |
| AP20 | history หลังปิดเมนู → ไม่ใช้คำตอบเก่าเป็นข้อมูล | [line-source](line-source-result.json), [line-draft-delivery](line-draft-delivery-result.json) |
| AP21 | source / branch / employee / replay เปลี่ยน → ตรวจใหม่ | [line-receipt-source](line-receipt-source-result.json), [line-text-source](line-text-source-result.json), [line-clarification-source](line-clarification-source-result.json) |
| AP22 | ถอนสิทธิ์ระหว่าง model/queued delivery → ระงับข้อความเก่า | [line-draft-delivery](line-draft-delivery-result.json), [line-canonical-binding](line-canonical-binding-result.json), [signature-upload-access](signature-upload-access-result.json) |
| AP23 | รูป/PDF/draft/final action → permission/quota/current source | [line-media-source](line-media-source-result.json), [line-continuation-source](line-continuation-source-result.json), [receipt-upload-source](receipt-upload-source-result.json) |
| AP24 | identity / กลุ่ม / เลือกบริษัท / unlink / กลับเว็บ | [line-canonical-binding](line-canonical-binding-result.json), [line-admin-qr-repair](line-admin-qr-repair-result.json), [line-queued-billing-browser](line-queued-billing-browser-result.json) |

## Browser CI correction

[Current browser correction](ci-browser-correction-result.json) covers CT03/CT31/CT32 and the overdue queue: exact API response, rendered rows, next-page cursor, case return and reload under normal/slow rendering. The remaining CI browser sequence and local tail contract checks pass.

## CI fixture correction

[Current correction evidence](ci-correction-result.json) covers CT24a with real429, original preview/cancel and no provider dispatch, plus the complete non-browser CI path. Product source is unchanged from the333-group browser run.

## Contract clarifications

- AP04: commercial entitlement และ launch gate เป็นคนละชั้น. Admin เปลี่ยนเมนูไม่สามารถเปิด launch gate ที่ CLOSED; execution ถูกปฏิเสธตาม launch guard. Dependency cascade ต้องยืนยัน ส่วน parent-off ใช้ parent+child guard ไม่จำเป็นต้องเขียน child-off ทับทุกตัวโดยอัตโนมัติ. Preset บันทึก explicit17keys ตามที่แสดง.
- CT22: ใช้ Stripe pause_collection.keep_as_draft พร้อม resumes_at; บิลก่อนพักอาจยังถูกเรียกเก็บ และกลับมาเก็บไม่ตัด historical draft อัตโนมัติ. [Stripe official reference](https://docs.stripe.com/billing/subscriptions/pause-payment), ตรวจ2026-09-15. พักเก็บเงินไม่ใช่ต่อวัน/เพิ่มโควตา.
- Email history cleanup เป็นข้อมูลประวัติภายใน; original delivery/dedupe/suppression/audit ยังอยู่. Callback ต้องตรวจ auth/type/source และ replay ตาม [Postmark webhook reference](https://postmarkapp.com/developer/webhooks/webhooks-overview), ตรวจ2026-09-15. Provider verification และ Inbox placement ไม่ได้เกิดจาก cleanup.

## Before opening real service

Native Stripe account capability/เงินจริง, Postmark app secret binding/webhook verification/allowlist/inbox placement, native LINE iOS/Android return and channel delivery remain release acceptance. Dedicated Postmark manual SMTP delivery has separate [native evidence](../postmark-native-delivery-2026-09-15.md); it does not establish deployed app delivery. No deploy/live activation/customer-gate changes are part of this merge task.
