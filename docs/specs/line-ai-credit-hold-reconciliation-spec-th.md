# Spec: LINE AI — การเคลียร์เครดิตที่กันไว้ค้าง (unresolved holds และ breach)

## 1. สถานะและขอบเขต

- วันที่: 2026-09-18
- สถานะ: owner อนุมัติข้อเสนอ 3 ชั้น (ข้อความ 2026-09-18 "5. ok ตามข้อเสนอ"); ยังไม่ implement / deploy
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

- `GET /v1/system/partners/:id/ai-credit-holds` (`system.partner_dashboard.read`): เรียก lazy sweep เดียวกับ admission ก่อน (idempotent) แล้วคืนรายการ hold ของเดือนปัจจุบันและเดือนก่อนที่ `status ∈ {UNRESOLVED}` และรายการ `breach = true` ที่ยังไม่ acknowledged; ต่อรายการ: id, stepKind (ป้ายไทย: แชต/อ่านเอกสาร/…), bucket, upperBoundSatang, settledCostSatang (breach), createdAt/dispatchedAt, อายุ, sourceRoute/requestKind, invocationKey (ย่อ), status; ไม่มีข้อความลูกค้า
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

- [ ] J-01 Gateway: settle ที่ล้มเหลวถูกโพสต์ซ้ำนอกเส้นทางคำขอจนสำเร็จภายใน backoff; business call ไม่ช้าลง; คิวมีเพดาน; SHARED byte-identical (spec เดิมไม่แตะ)
- [ ] J-02 Gateway: SIGTERM ระหว่าง provider call ⇒ call จบ, หลักฐานโพสต์แล้วจึงออก; log สรุป; ทดสอบด้วย fake provider/fake API ในโปรเซส
- [ ] J-03 API: route อ่านคืนรายการถูกต้องหลัง sweep; permission read/manage/tenant ถูกปฏิเสธถูกต้อง (DenyByDefaultGuard test)
- [ ] J-04 API: release/charge_at_bound/acknowledge ถูกต้องบน PostgreSQL จริง (pg spec: fence, ซ้ำ ⇒ 409, ไม่ deadlock กับ reserve/settle ที่แข่งกัน, late evidence หลัง release ⇒ `settled-anomaly` บันทึกเต็ม, aggregate ถูกต้อง, breach ack เปิด admission)
- [ ] J-05 Web: section ใหม่ที่ 1440/390 (ว่าง, มีรายการ, read-only, locked, หลังกดปล่อย, หลังกดคิดตามยอด, breach ack) — browser evidence; ประวัติการปรับแสดงแถวใหม่เป็นไทย
- [ ] J-06 Alert: ทดสอบ sweep นับ/throttle/ข้อความ; ไม่มีเงินลูกค้าในข้อความ
- [ ] J-07 D1 breakdown: basis ใหม่แสดงป้ายไทยและไม่ถูกนับเป็นจำนวน call ของโมเดล
- [ ] J-08 UAT: จำลอง hold ค้าง (synthetic) แล้วเคลียร์ผ่านหน้าเว็บจริง; ไม่แตะบริษัทจริง

## 7. ไม่ทำ

กู้หลักฐานจาก CloudWatch (บันทึกเหตุผลใน §2), bulk actions, auto-release ตามเวลา, การเปลี่ยน ADR เรื่อง no-TTL, การแก้ bound ที่ประกาศ (แยกงาน)
