# ต้อนรับร้านใหม่และช่วยเลือกแพ็กเกจใน LINE

วันที่: 2026-10-30 (Asia/Bangkok)
สถานะ: OWNER AUTHORIZED IMPLEMENTATION / LOCAL VERIFICATION
Owner: thawatchai
แผน: [implementation plan](../plans/new-shop-welcome-package-advisor-plan-th.md)
Memory: [story and task state](../agent-memory/new-shop-welcome-and-package-advisor-story.md)

## Product decision and scope

ผู้ใช้อนุมัติ story/persona และให้ “ลองทำดู ให้ sol luna ช่วย ตามความเหมาะสม” หลังเลือกแบบหน้าเว็บ LIFF ที่เปิดจากปุ่มในแชท LINE

- ข้อความต้อนรับส่งครั้งเดียว เฉพาะบริษัท/ร้านที่สร้างใหม่ผ่าน LINE ตั้งแต่ implementation นี้ ไม่ส่งย้อนหลังให้ร้านเดิม ไม่ส่งเมื่อ login/reopen และไม่ส่ง campaign เตือนซ้ำ
- ร้านต้องสร้าง/ผูกสมาชิกสำเร็จจริงและยังเข้าเกณฑ์ free-expense-drafts ณ ก่อนส่ง ข้อความแจ้งสิทธิ์อ่านฟรี 3 ใบต่อบริษัท/เดือนตาม source จริง ไม่เปิด free AI chat ไม่ grant/reset โควตา
- น้องมั่งมีเป็นผู้ช่วยดูแลร้าน แทนตัวว่า “มั่งมี” ใช้ “คุณ” หรือเว้นสรรพนาม สุภาพอบอุ่น ไม่ใส่ emoji/ลูกศรหรือเร่งให้ซื้อ
- สามทางเลือก: ลองส่งใบเสร็จ, ช่วยเลือกแพ็กเกจให้หน่อย, คุยกับทีมดูแล
- แบบประเมินเป็น public read-only LIFF form สี่ข้อ ไม่ต้องเรียกโมเดล ไม่ต้องส่งคำตอบเป็นข้อความ ไม่บันทึกคำตอบลง CRM และไม่สร้างการซื้อ การดูหน้าเองไม่สร้าง welcome event
- คุยกับคนผ่าน OA ทีมดูแล `https://lin.ee/6Sc38L6`; ใบเสร็จยังส่งผ่าน OA ระบบเดิม
- ไม่รวม deploy, cloud inspection, LINE Console change, real customer messaging, billing-policy/catalog mutation หรือการแก้ sibling marketing repository

Owner amendment: แทน D03 เฉพาะส่วน “ไม่มี welcome offer” ใน [free receipt policy](free-expense-drafts-spec-th.md) ด้วย welcome ครั้งเดียวตาม eligibility/creation fence นี้ คงการตอบใบ1–2ตามปกติ การแจ้งครบ การไม่แทรกขายระหว่างแก้ร่าง และไม่ backfill ร้านเก่า ส่วนข้อห้าม broad broadcast ใน signup spec คงเดิม

## Journey and copy

หลัง provision สำเร็จ ใช้ approved/attached notification slot เดิม:

> สวัสดีค่ะ มั่งมีนะคะ ผู้ช่วยดูแลร้านของคุณ
>
> ยินดีต้อนรับร้าน {ชื่อร้าน} ค่ะ มั่งมีจะช่วยอ่านใบเสร็จและเตรียมรายการรายจ่ายไว้ให้คุณตรวจดู
>
> เริ่มจากใบเสร็จสักใบก่อนก็ได้ค่ะ ลองส่งฟรีได้เดือนละ 3 ใบ โดยยังไม่ต้องซื้อแพ็กเกจ
>
> ถ้ายังเลือกแพ็กเกจไม่ถูก ให้มั่งมีช่วยดูได้ค่ะ หรือจะคุยกับทีมดูแลก่อนก็ได้นะคะ

หากใช้ไปก่อนส่งแล้ว ใช้ข้อความคงเหลือจริงที่ไม่สัญญา3ใบใหม่ หากครบแล้วละคำชวนส่งฟรีเพิ่ม/เปลี่ยนข้อความตามยอดจริง หากไม่เข้าเกณฑ์ฟรีแล้วให้ใช้ข้อความเปิดร้านตามสถานะเดิม ไม่สัญญา trial/สิทธิ์เก่า

Receipt CTA ใช้ public deterministic menu เดิมที่ตรวจสิทธิ์อยู่แล้ว; คำแนะนำที่เปิดจาก welcome นี้ใช้ภาษาชุดใหม่และไม่มี emoji โดยไม่เปลี่ยน routing ของรูปหรือข้าม access gate

Advisor intro: “มั่งมีขอรู้จักร้านอีกนิดนะคะ มีคำถามสั้น ๆ 4 ข้อ จะได้ช่วยดูว่าแพ็กเกจไหนเหมาะกับงานที่ร้านใช้จริง”

1. ที่ร้านมีคนช่วยดูแลใบเสร็จและรายจ่ายกี่คนคะ? นับตัวคุณด้วยนะคะ
2. แต่ละเดือนมีใบเสร็จให้ดูแลประมาณกี่ใบคะ? เลือกจำนวนคร่าว ๆ ได้ค่ะ ถ้ายังไม่แน่ใจก็ไม่เป็นไร
3. ตอนนี้อยากให้มั่งมีช่วยงานไหนมากที่สุดคะ? อ่าน/เก็บใบเสร็จ, รวบรวมรายจ่าย, ดูภาพรวมร้าน, ช่วยทีมทำงานร่วมกัน
4. ปกติที่ร้านเก็บใบเสร็จและจดรายจ่ายกันอย่างไรคะ? กระดาษ/สมุด, ตาราง, โปรแกรมเดิม, สำนักงานบัญชี

หน้าทีละข้อ มีความคืบหน้า คำตอบแบบเลือกหนึ่ง ถัดไปหลังเลือก ย้อนกลับโดยเก็บคำตอบ และทางกลับไปส่งใบเสร็จ/คุยทีมดูแลทุกช่วง หน้า LIFF ใช้ visual ธีมเขียวปกติ/มาสคอต/กรอบคำถามตาม owner correction (ม่วงในภาพอ้างอิงเป็น Halloween ชั่วคราว) ปรับ responsive320/390/736ตามแพลตฟอร์ม ไม่คัดลอก mock catalog หรือภาพ screenshot ทั้งหน้ามาใส่ production

## Actual catalog and recommendation contract

- ใช้ public `GET /v1/billing/catalog` จาก `BillingService.catalog()` เท่านั้น ไม่ hardcode ราคา/label/capacity/availability และไม่ใช้ static marketing promo image
- คำตอบข้อ1–2ใช้ช่วงจำนวนจาก monthly catalog capacity ที่เป็นบวก จำกัด/validate payload; เก็บค่าขอบบนของช่วง ไม่ใช้ index แทนความต้องการ มี over-range และ “ยังไม่แน่ใจ” สำหรับจำนวนเอกสาร
- เลือก monthly AVAILABLE offer ที่รองรับคน/จำนวนเอกสารและ feature family ตามงานที่เลือก โดยเรียง priceSatangน้อยก่อนและ tie-breakด้วย capacity/tier ที่คงที่; upper boundเป็นประมาณการแบบ conservative ไม่อ้างเป็นจำนวนใช้งานจริง
- Goal maps: receipt/expense uses `expenses`; overview uses `dashboard_notifications`; teamwork uses `employee_access`. ไม่อ้าง all-feature/report/ledger/tax capabilities เกิน featureKeys ของ offer
- ข้อ4เปลี่ยนคำแนะนำเริ่มใช้งาน ไม่เพิ่ม tier/ราคา; unknown receiptsระบุคำแนะนำเบื้องต้น ไม่เดาปริมาณเอกสาร; over-rangeไม่มีการฝืนจับเข้าแพ็กเกจสูงสุด ให้คุยทีมดูแล
- ผลมีหนึ่งแพ็กเกจ label/ราคา/รอบบิล/จำนวนคน/เอกสารจริง และเหตุผลจากคำตอบ; ไม่แสดงเครดิต AI/โปรโมชั่นสมมติ; Owner correction: ไม่แสดงข้อความ VAT/ภาษีในหน้าผลแนะนำแพ็กเกจ ผู้ใช้ยืนยันว่าบริษัทยังไม่จดทะเบียน; ไม่แก้ calculation/policy ของ billing จากงานแก้ข้อความนี้
- Catalog loading/error/empty/closed/malformed/expiredมีข้อความและ retry/support ที่ใช้งานได้ ไม่ fallback สู่ fictional/default sellable prices; no catalog consent or checkout from assessment
- โหลด catalog ใหม่ก่อนคำนวณผลและก่อนส่งต่อไป billing หาก revision/offer เปลี่ยนแสดงคำแนะนำปัจจุบันให้ตรวจอีกครั้ง ไม่ส่งต่อจากราคาเก่า
- การไป billing เป็น explicit click เท่านั้นผ่าน LINE identity/session handoff เดิม โดยเพิ่มตัวเลือก billingOffer/intervalแบบ enumแคบ ไม่รับ arbitrary target URL; บริษัทต้อง resolveจาก live membership/contextหรือ picker และตรวจ guardเดิมก่อน mint
- Handoff target: `/companies/{verifiedCompanyId}/billing?offer={knownPaidTier}&interval={month|year}&channel=line`; billing quote/review/capacity/permission/readiness ตรวจใหม่เหมือนเดิม ไม่มี checkout/purchase mutationจาก form
- ข้อมูลคำถามอยู่ในหน้า/หน่วยความจำของ browser ในรอบนั้น ไม่ส่งให้บุคคลที่สาม ไม่ประกาศ shopNameจาก queryที่ไม่ได้ verify และไม่บันทึก tokenลง localStorage

## Architecture and delivery

- Reuse API-served LIFF shell and strict CSP; new page aliases `/v1/auth/line/link-page/package-advisor` and `/v1/auth/line/package-advisor-page`, same-origin dedicated JS. SDK origin unchanged, no inline executable JS or new dependencies
- Public page contains only catalog/form; no tenant/private document data. Receipt return uses configured system OA URL or LIFF close with clear fallback; support links cannot receive credentials or private answers
- Welcome cohort marker persists in existing onboarding audit metadata inside the transaction that creates the new Company/User/Membership. Store version and originating signup request id only on actual new LINE-company creation, never on adoption of an existing company. Recovery of the same request retains the marker atomically; a different request adopting a marked company is outside the cohort
- Notification reads creation marker and current request/company/owner/LINE binding/free policy before render/send; old events without marker retain existing message path. Reuse eventKey and LINE retry key so welcome replaces rather than adds a notification
- Keep source-state, current recipient/tenant, legal/hold/permission and quota boundaries. Existing operator manual/admin/trial tiers do not acquire free copy just because current paid account is absent
- Locked generic system card pattern is reused for LINE delivery where applicable; LIFF is a separate screen with accepted preview direction

## Acceptance

| ID | Required evidence |
|---|---|
| A01 | New eligible LINE-created company has durable marker and receives one warm welcome in existing event slot |
| A02 | Existing/adopted company, old queued request, login/reopen/retry cannot acquire new welcome; crash/retry uses original marker/key |
| A03 | Paid-before-send, hold, inactive/revoked owner/LINE, other-company context, used/free-exhausted state never get a false free promise or wrong private recipient |
| A04 | Card has three correct actions; receipt command keeps existing permission checks; staff route is second OA; advisor route configured and token-free |
| A05 | All four questions, back/edit/skip, unknown and over-capacity work on mobile and desktop with natural Thai/no emojis |
| A06 | Actual catalog labels/prices/limits/features/availability used; no VAT/tax wording on the recommendation screen; malformed/closed/failed/stale catalog does not invent an offer; late update reviewed before billing |
| A07 | Explicit billing handoff keeps offered tier/interval through current identity/company selection; malicious parameters/foreign company/revoked identity fail; no premature billing mutation |
| A08 | Shared LIFF signup/start/recovery and billing routes retain focused regression checks; CSP and rendered unsafe data tested |
| A09 | Actual local browser traversal with source-backed catalog fixture, mobile and desktop; external LINE/provider/native-device evidence reported separately |

Release requires separate instruction and repository cloud/UAT protocols. Local tests and browser fixtures do not prove live delivery or deployed eligibility.

## Owner copy correction

- ไม่แสดงข้อความ VAT ในผลแนะนำแพ็กเกจ; ค่าที่แสดงใน screenshot รอบแรกมาจาก fixture ที่ agent ตั้งเอง ไม่ใช่สถานะภาษีจริงของบริษัท
- คำแนะนำสำหรับผู้ใช้ตาราง: “เริ่มจากส่งใบเสร็จสักใบ แล้วตรวจข้อมูลที่มั่งมีอ่านให้ก่อนบันทึกได้เลยค่ะ” ไม่ใช้คำว่าย้ายข้อมูลจากตาราง เพราะไม่มีการย้ายข้อมูลเก่าใน flow นี้

- Owner theme correction: ใช้สีเขียวธีมปกติของมั่งมีทั้ง welcome, แบบประเมิน และผลลัพธ์; สีม่วงในภาพอ้างอิงเป็น seasonal Halloween เท่านั้น. Reuse shared LIFF `--brand-dark`, `--ink`, `--muted`, `--line`, `--ground`; welcome primary uses the same accessible green #15803D.
- Owner button correction: ไม่ใช้ข้อความขีดเส้นใต้สำหรับปุ่มกด ใช้ปุ่มตามธีมเขียวทั้งการกลับไปแก้คำตอบ ลองส่งใบเสร็จ และคุยกับทีมดูแล ปุ่มหลักพื้นเขียว ปุ่มรองพื้นขาวมีกรอบและข้อความเขียว

## Integration with current main/develop

- ใช้ `STAFF_OA_URL` จาก staff-menu logic ปัจจุบันเป็นปลายทางทีมดูแลร่วมกันทั้ง welcome และ advisor; ค่า ณ integration คือ `https://lin.ee/6Sc38L6` แทน literal จาก preview เดิม
- คง LIFF shared-client cache URL, sales-event landing, deep-link opening และ free-expense guards จาก baseline ล่าสุด; billingOffer เพิ่มเฉพาะการเลือกแพ็กเกจเพื่อเปิดหน้าตรวจรายละเอียด
- Owner อนุมัติ merge และ push เข้า main/develop โดยไม่เปิด PR; ไม่รวม UAT/Production deployment
