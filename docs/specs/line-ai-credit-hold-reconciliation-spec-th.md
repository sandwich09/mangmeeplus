# Spec: LINE AI — การเคลียร์เครดิตที่กันไว้ค้าง (unresolved holds และ breach)

> ส่วนเพิ่มจาก [สเปก add-on](chat-credit-and-receipt-addons-spec-th.md) 2026-09-29: หน้าลูกค้าไม่แสดงยอดกันไว้ และรวมยอดทีมงาน+ยอดซื้อเป็น “ยอดเพิ่มเติม” (§17). การจอง/กู้รายการและมุมมอง operator ในเอกสารนี้ยังทำงานตามเดิม; ห้ามคืนยอดที่จองเพียงเพื่อซ่อนตัวเลข หรือใช้ projection ของลูกค้าแทนข้อมูลที่ operator ต้องตรวจ. สำหรับร้านที่ย้ายแล้ว hold ของ LINE v2 ใน SHARED ผูก funding ของเครดิต AI (แพ็กเกจ → ทีมงาน → ซื้อ, add-on §5.3/T-04) — **implement แล้วใน add-on PR C (2026-09-29)**: entry `RESERVE` ของ lot นับเป็นยอดกันไว้เฉพาะขณะ reservation ยัง live (RESERVED/DISPATCHED/UNRESOLVED) จึงให้ operator release, cancel และ sweep คืนเครดิตด้วยสถานะ reservation ที่เขียนอยู่แล้วโดยไม่ต้องเขียน entry เพิ่ม; settle และ charge-at-bound เขียน `CONSUME` ของ lot เดิมไม่เกินยอดที่กันไว้ (lock เดือนเดิม); หลักฐานที่มาช้าหลัง release บันทึกต้นทุนเต็มแต่ไม่ตัดเครดิตซ้ำ (ผู้ให้บริการรับ) และไม่หยิบ lot ใหม่; หน้า operator ค้น hold ได้ทุกเดือนแบบแบ่งหน้า (sweep ทุกเดือนที่ยังมีแถว RESERVED/DISPATCHED ก่อนอ่าน)

Owner amendment 2026-10-19: breach remains an operator alert and audit history; it no longer closes customer admission. Acknowledgement clears the alert only. Successful v2 overruns charge at most actual and available customer credit, with shortfall absorbed by the company; failed/time-out calls charge zero. This supersedes closure/reopening descriptions below; see [credit levers spec](line-ai-credit-levers-20261019.md).

## 1. สถานะและขอบเขต

- วันที่: 2026-09-18
- สถานะ: owner อนุมัติข้อเสนอ 3 ชั้น (ข้อความ 2026-09-18 "5. ok ตามข้อเสนอ"); **implement แล้วครบทั้ง 3 ชั้น และ verify ในเครื่อง** (J-01…J-07 ติ๊กแล้ว); ยังไม่ deploy — J-08 (UAT) ยังเปิด
- ต่อจาก: [ADR 0013](../adr/0013-ai-budget-split-reservations.md) (reservation lifecycle, `UNRESOLVED`, `breach`, no TTL release), [spec wave 2](line-ai-credit-wording-and-deterministic-reads-spec-th.md) (คำว่า "เครดิต AI")
- ผู้ใช้: System Admin (`system.partner_ai_model.manage`), operator อ่านอย่างเดียว (`system.partner_dashboard.read`), และร้านค้า (เห็นผลทางอ้อม: เครดิตที่กันไว้ค้างทำให้เครดิตที่ใช้ได้น้อยลง)
- [แผนงาน](../plans/line-ai-credit-wording-and-deterministic-reads-plan-th.md) (### H3)

ปัญหา: เครดิตที่กันไว้ก่อนเรียก AI (reservation) จะกลายเป็น `UNRESOLVED` เมื่อหลักฐานผลการเรียกกลับมาไม่ถึง API (gateway ล่มกลางทาง, API ไม่ว่างนานกว่า retry, ฯลฯ) ระบบตั้งใจไม่ปล่อยเองตามเวลา (ADR §7) เพราะเงินอาจถูกใช้จริง วันนี้ไม่มีทั้งกลไกกู้หลักฐานอัตโนมัติ ไม่มีหน้าสำหรับ operator และ `breach` (ใช้จริงเกินที่กันไว้) ปิด admission ของส่วนนั้นไว้โดยไม่มีทางเคลียร์

## 2. หลักฐานและข้อจำกัดที่ใช้ออกแบบ

| ข้อเท็จจริง | ผลต่อการออกแบบ |
| --- | --- |
| Gateway ไม่มี DB/Redis; หลักฐานการใช้ token ส่งถึง API สองทาง: `POST /internal/ai/budget-settle` (retry 2 ครั้ง ห่าง 200 ms) และ usage rows ในการตอบ HTTP (response path = idempotent duplicate) | หลักฐานหายเมื่อ **ทั้งสองทาง** ล้มเหลว: API ล่ม/ไม่ว่างนานกว่า 200 ms ขณะที่ request ฝั่ง API หมดเวลาไปแล้ว, หรือ gateway ถูก stop/ล่มก่อนโพสต์ |
| Gateway log `ai.usage` เขียนใน `finally` หลัง provider call พร้อม `invocationKey` | ถ้า process ตายกลาง call ก็ไม่มี log เช่นกัน → การกู้จาก CloudWatch ช่วยเฉพาะกรณี "โพสต์ไม่ถึง" ซึ่งชั้น 1 ด้านล่างปิดได้เกือบทั้งหมดโดยไม่ต้องเพิ่ม IAM/SDK; จึงไม่ใช้ CloudWatch ใน spec นี้ |
| Lazy sweep ใน `reserveAiBudgetStep`: `RESERVED` > 10 นาที → `CANCELLED (never_dispatched)`; `DISPATCHED` > 30 นาที → `UNRESOLVED` (ยังนับเป็นเงินที่กันไว้) | sweep ทำงานเฉพาะเมื่อบริษัทนั้นมี traffic ใหม่ → หน้า operator ต้องเรียก sweep เดียวกันก่อนอ่าน |
| `breach = true` ปิด admission ของ scope จนกว่า operator จะเคลียร์ (schema comment) แต่ไม่มี field/route สำหรับเคลียร์ | ต้องมี acknowledgement ที่ audit ได้ |
| การยกเลิก hold ปัจจุบันต้องมี `ownerToken` + proof (`never_dispatched` / `gateway_pre_provider_refusal`) | การกระทำของ operator ต้องเป็น proof ใหม่ที่ไม่ใช้ ownerToken แต่ fence ด้วย `status = 'UNRESOLVED'` + reservation id |
| หลักฐานที่มาช้าหลังยกเลิกยังถูกบันทึกเต็มผ่าน `settled-anomaly` (ADR §11.6) | การปล่อยเครดิตโดย operator ที่ผิดพลาดไม่ทำให้เงินจริงหาย — เพียงทำให้เดือนนั้นบันทึกเกินเพดานได้ และมี HIGH event |

## 3. ชั้นที่ 1 — ไม่ให้หลักฐานหายขณะ gateway ยังอยู่ (gateway)

- **Durable settle retry ในโปรเซส**: เมื่อ `budget-settle` ล้มเหลวหลัง 2 ครั้งแรก ให้เก็บหลักฐาน (invocationKey, usage entry, sourceRoute, companyId) ไว้ในคิวในหน่วยความจำและโพสต์ซ้ำแบบ backoff (เช่น 1s, 5s, 30s, 60s… รวมไม่เกิน 10 นาที) นอกเส้นทางคำขอ — ห้ามหน่วง business call; ขนาดคิวมีเพดาน (เช่น 1,000 รายการ) ล้นแล้ว log `ai.budget.settle_evidence_dropped` (ids เท่านั้น)
- **Graceful drain**: เปิด shutdown hooks ของ Nest (`enableShutdownHooks`) และเมื่อได้รับ SIGTERM ให้ (1) หยุดรับคำขอใหม่ (2) รอ provider call ที่ค้างจนจบภายในเวลาที่ ECS ให้ (ต่ำกว่า `stopTimeout` ปัจจุบัน — ยืนยันค่าจริงใน `deploy.sh`) (3) โพสต์คิวหลักฐานให้หมดก่อนออก — ทุกขั้นมี log สรุป (จำนวนที่โพสต์ได้/ไม่ได้)
- ไม่มี envelope ⇒ ไม่มีอะไรเปลี่ยน (SHARED ยังเหมือนเดิมทุกไบต์)
- ผล: `UNRESOLVED` เหลือเฉพาะ hard crash (OOM/kill -9/host หาย) ซึ่งไม่มีหลักฐานที่ใดจริง ๆ

## 4. ชั้นที่ 2 — หน้า operator ในแอดมินคอนโซล (API + web)

### 4.1 อ่าน

- `GET /v1/system/partners/:id/ai-credit-holds` (`system.partner_dashboard.read`): เรียก lazy sweep เดียวกับ admission ก่อน (idempotent) แล้วคืนรายการ hold ของทุกเดือน (add-on PR C: ครั้งละ 100 รายการ ใหม่ก่อน ต่อด้วย `?cursor=`; เดิมอ่านเฉพาะเดือนปัจจุบันและเดือนก่อน) ที่ `status ∈ {UNRESOLVED}` และรายการ `breach = true` ที่ยังไม่ acknowledged; ต่อรายการ: id, stepKind (ป้ายไทย: แชต/อ่านเอกสาร/…), bucket, upperBoundSatang, settledCostSatang (breach), createdAt/dispatchedAt, อายุ, sourceRoute/requestKind, invocationKey (ย่อ), status; ไม่มีข้อความลูกค้า
- หน้า partner "AI และโควตา": section "เครดิตที่กันไว้ค้าง" ใต้ตารางเพดาน (ใช้คำตาม spec wave 2 §3) — ตาราง + ปุ่มต่อแถว; ว่าง ⇒ บรรทัดเดียว "ไม่มีรายการค้าง"; read-only operator เห็นตารางไม่มีปุ่ม; บริษัท locked ไม่มีปุ่ม

### 4.2 การกระทำ (`system.partner_ai_model.manage`, reason 1–500 ตัวอักษร, confirm dialog, audit)

| การกระทำ | ผลต่อเงิน | fence |
| --- | --- | --- |
| **ปล่อยเครดิตที่กันไว้** (`release`) | `UNRESOLVED → CANCELLED` proof `operator_released` + reason + userId; เครดิตที่กันไว้ลดลงทันที; ไม่มี usage event | `updateMany where id AND status='UNRESOLVED'` ใต้ advisory lock `ai-budget:<company>:<month>`; แถวเดียว; ซ้ำ ⇒ 409 `partner_ai_credit_hold_already_resolved` |
| **คิดตามยอดที่กันไว้** (`charge_at_bound`) | `UNRESOLVED → SETTLED` โดยบันทึก usage event ที่ `costSatang = upperBoundSatang`, `usageBasis = 'OPERATOR_CHARGED_AT_BOUND'` (member ใหม่ additive ของ `AiUsageBasis`), เดินผ่าน settlement เดิม (aggregate เดือน + bucket, `invocationKey` fence) ด้วย token = 0 และ cost ที่ระบุ; event นับใน D1 breakdown เป็น basis ใหม่ (ป้ายไทย "operator คิดตามยอดที่กันไว้") | เหมือนข้างบน + ห้ามซ้ำด้วย `invocationKey` unique เดิม |
| **รับทราบ breach** (`acknowledge_breach`) | ไม่แตะเงิน; ตั้ง `breachAcknowledgedAt/By` (คอลัมน์ใหม่ additive) → `readAiBudgetMonthSnapshot.breach` นับเฉพาะที่ยังไม่ acknowledged → admission ของ scope กลับมาเปิด (ตาม ADR §11.6 "until an operator clears it") | แถวที่ `breach=true AND breachAcknowledgedAt IS NULL` |

- ทุกการกระทำเขียน `AuditLog` (action ใหม่: `ai.credit_hold.released`, `ai.credit_hold.charged_at_bound`, `ai.credit_breach.acknowledged`) และแถวใน `PartnerAiAdjustmentHistory` (ป้ายไทย) เหมือนการปรับเครดิตอื่น
- หลักฐานที่มาช้าหลัง `release`: ยังบันทึกเต็มผ่าน `settled-anomaly` (เดิม) — UI ต้องอธิบายในบรรทัดช่วยเหลือว่า "ถ้ามีหลักฐานการใช้จริงมาถึงภายหลัง ระบบจะบันทึกยอดจริงเพิ่มเอง"
- ไม่มี TTL/auto-release; ไม่มี bulk action ใน wave นี้

## 5. ชั้นที่ 3 — แจ้งเตือน

- Sweep ทุก 15 นาทีที่มีอยู่ (`SignupOpsAlertService` pattern, `raise(kind)`) เพิ่ม `ai_credit_holds_unresolved`: นับบริษัทที่มี `UNRESOLVED` อายุ > 24 ชม. หรือ `breach` ยังไม่ acknowledged; เกิน 0 ⇒ notification event + LINE push ถึงแอดมินที่เชื่อม LINE วันละไม่เกิน 1 ครั้งต่อ kind (throttle เดิม) พร้อมลิงก์หน้า partner; เนื้อความไม่มีตัวเลขเงินของลูกค้า
- ค่าตั้ง `AI_CREDIT_HOLD_ALERT_AFTER_HOURS` default 24 (config additive)

## 6. Acceptance

- [x] J-01 Gateway: settle ที่ล้มเหลวถูกโพสต์ซ้ำนอกเส้นทางคำขอจนสำเร็จภายใน backoff; business call ไม่ช้าลง; คิวมีเพดาน; SHARED byte-identical (spec เดิมไม่แตะ) — `ai-usage.interceptor.spec.ts` (fake API ล้ม 2 ครั้งในคิวแล้วสำเร็จ → โพสต์สำเร็จครั้งเดียว; `rejected` ไม่ retry; หมดอายุ 10 นาที; ล้น 1,000 → `settle_evidence_dropped`; seam คืน `unreachable` ใน < 1s และคิวไม่ได้รันในเส้นทางนั้น; ไม่มี envelope ⇒ ไม่ settle ไม่นับ in-flight)
- [x] J-02 Gateway: SIGTERM ระหว่าง provider call ⇒ call จบ, หลักฐานโพสต์แล้วจึงออก; log สรุป; ทดสอบด้วย fake provider/fake API ในโปรเซส — `app.enableShutdownHooks()` + `AiBudgetShutdownService`; เทสต์เรียก hook ตรง ๆ (รอ in-flight แล้ว flush ข้าม backoff, 1 บรรทัดสรุปเฉพาะตัวเลข, call ที่เกิน budget รายงานตรง ๆ ไม่รอค้าง, ไม่มีอะไรค้าง ⇒ no-op)
- [x] J-03 API: route อ่านคืนรายการถูกต้องหลัง sweep; permission read/manage/tenant ถูกปฏิเสธถูกต้อง (DenyByDefaultGuard test) — `partner-ai-credit-holds.use-case.spec.ts` (sweep ทั้งเดือนนี้และเดือนก่อนก่อนอ่าน, DTO ไม่มีข้อความลูกค้า, bucket/requestKind ที่ไม่รู้จัก = UNKNOWN), `partner.controller.spec.ts` (guard: tenant caller และ read-only ถูกปฏิเสธที่ 3 action, read เปิดได้), pg spec ยืนยันว่า sweep เปลี่ยน DISPATCHED → UNRESOLVED ก่อน list
- [x] J-04 API: release/charge_at_bound/acknowledge ถูกต้องบน PostgreSQL จริง — `company-ai-credit-holds.pg.spec.ts` 10/10 (กด 2 และ 6 ครั้งพร้อมกัน ⇒ ชนะ 1 เสมอ และ audit 1 แถว; charge ขยับ aggregate เดือน+bucket ครั้งเดียว `callCount = 0`; ปล่อยแล้วคิดไม่ได้/คิดแล้วปล่อยไม่ได้; reservation ของ tenant อื่น = not-found ไม่เขียนอะไร; ack เปิด OCR กลับมาโดย CHAT ไม่เคยถูกปิด และเงินที่บันทึกไม่เปลี่ยน; late evidence หลัง release ⇒ `settled-anomaly` บันทึกเต็ม + `anomaly.previousStatus = CANCELLED`; 20 รอบ decision แข่งกับ reserve/settle ไม่ deadlock)
- [x] J-05 Web: section ใหม่ที่ 1440/390 — [browser evidence](../qa/evidence/line-ai-credit-holds-2026-09-18/README.md): 12 subject × 2 viewport (ว่าง, มีรายการ, breach, locked, read-only, confirm ทั้ง 3, หลังกดทั้ง 3, ประวัติ), overflow 0 px ทุกภาพ, ไม่มี client error; ประวัติการปรับแสดง 3 แถวใหม่เป็นไทยครบ
- [x] J-06 Alert: ทดสอบ sweep นับ/throttle/ข้อความ; ไม่มีเงินลูกค้าในข้อความ — `signup-ops-alert.service.spec.ts` (นับ **บริษัท** ไม่ใช่แถว, เกณฑ์อายุจาก `AI_CREDIT_HOLD_ALERT_AFTER_HOURS` และ breach ไม่มีเกณฑ์อายุ, วันละ 1 ครั้งตาม Bangkok day และไม่กลบ kind อื่น, ข้อความไม่มีตัวเลขใด ๆ และไม่มีชื่อร้าน, ลิงก์ไปหน้า partner)
- [x] J-07 D1 breakdown: basis ใหม่แสดงป้ายไทยและไม่ถูกนับเป็นจำนวน call ของโมเดล — `OPERATOR_CHARGED_AT_BOUND` อยู่ใน `byUsageBasis` พร้อมป้าย "operator คิดตามยอดที่กันไว้"; เขียนเป็น `eventKind = COST_ADJUSTMENT` จึงไม่เข้า `calls`/`coverage` แต่ยอดเงินยัง reconcile กับ `total` (`get-partner-ai-usage.use-case.spec.ts` + pg spec)
- [ ] J-08 UAT: จำลอง hold ค้าง (synthetic) แล้วเคลียร์ผ่านหน้าเว็บจริง; ไม่แตะบริษัทจริง — ยังไม่ทำ (ต้อง deploy UAT ก่อน)

## 7. ไม่ทำ

กู้หลักฐานจาก CloudWatch (บันทึกเหตุผลใน §2), bulk actions, auto-release ตามเวลา, การเปลี่ยน ADR เรื่อง no-TTL, การแก้ bound ที่ประกาศ (แยกงาน)
