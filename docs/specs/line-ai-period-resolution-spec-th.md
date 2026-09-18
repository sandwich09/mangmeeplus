# Spec: LINE AI — การตีความช่วงเวลาในคำถามอ่านข้อมูล (period resolution)

## 1. สถานะและขอบเขต

- วันที่: 2026-09-18
- สถานะ: owner decision รับแล้ว (ข้อความ 2026-09-18 "แก้ 5. เพิ่มหน่อย …"); ยังไม่ implement / deploy
- ต่อจาก: [spec wave 2](line-ai-credit-wording-and-deterministic-reads-spec-th.md) §6 (deterministic reads) และ ADR 0011 (value normalizer: ข้อความผู้ใช้ไม่ถูกเขียนใหม่ โมเดล "เลือก" จาก candidate ที่โค้ดอ่านได้ ไม่แปลงเลข/ปฏิทินเอง)
- ผู้ใช้: เจ้าของร้าน/พนักงานที่ถามข้อมูลธุรกิจผ่าน LINE (ยอดขาย ค่าใช้จ่าย ภาษี ปิดยอด ลูกค้าใหม่ …)
- [แผนงาน](../plans/line-ai-credit-wording-and-deterministic-reads-plan-th.md) (### H4)

Owner decision (ถอดจากข้อความ): **ค่าเริ่มต้นคือเดือนปัจจุบัน** หากผู้ใช้ระบุช่วงเวลา — ระบุวันที่/ช่วงตรง ๆ หรือบอกเป็นคำพูดที่ตีความได้ เช่น เดือนที่แล้ว วันก่อน อาทิตย์ที่แล้ว ปีที่แล้ว สัปดาห์ที่แล้ว เมื่อวาน ฯลฯ — คำตอบต้องเป็นไปตามช่วงเวลานั้น

## 2. สภาพปัจจุบันและช่องว่าง

| ข้อเท็จจริง (develop ≥ `f8e93882`) | ผล |
| --- | --- |
| `extractValueCandidates` (`packages/contracts/src/line-ai-value-normalizer.ts`) อ่านได้เฉพาะ "วันที่" ที่เขียนตรง ๆ (`dates[]`, รวมเดือน-ปีเป็น `month_period_boundary`) | คำพูดเชิงสัมพัทธ์ (เมื่อวาน, เดือนที่แล้ว, …) ไม่มี candidate |
| เส้นทางปกติ (`allowedLoopDates`): ถ้าไม่มี date candidate เลย โมเดลใส่ `fromDate/toDate` ได้อิสระ | โมเดลคำนวณวันที่เอง (เสี่ยงผิด: ปี พ.ศ./ค.ศ., ขอบเดือน, สัปดาห์) และไม่มีหลักฐานกำกับ |
| เลน deterministic (`preparedAllowedDates`): วันที่ที่ไม่มี candidate ถูกทิ้ง → เลนถอยไปเส้นทางปกติ | คำถามที่มีช่วงเวลาสัมพัทธ์ไม่เคยได้คำตอบสำเร็จรูป |
| `tax.get_vat_summary` ไม่ whitelist input ใด ทั้งที่ tool รับ `periodKey` | "ภาษีเดือนที่แล้ว" ตอบเดือนปัจจุบันเสมอ ทั้งสองเส้นทาง |
| `crm.get_customer_summary` รับเฉพาะ `newSince` (นับถึงตอนนี้) | "ลูกค้าใหม่เดือนที่แล้ว" นับรวมเดือนนี้ด้วย |
| `procurement.get_ap_outstanding`, `inventory.list_low_stock` เป็นสถานะ ณ ตอนนี้ ไม่มีช่วงเวลา | อยู่นอกขอบเขต (บอกผู้ใช้ว่าเป็นยอด ณ ตอนนี้) |
| Formatter ทุก family และ composer พิมพ์ "ช่วง/ณ วันที่" ที่ tool ตอบกลับ | คำตอบระบุช่วงที่ใช้จริงอยู่แล้ว — ต้องคงไว้ |

## 3. กติกา

### 3.1 ตัวแปลช่วงเวลา (deterministic, ใน `packages/contracts`)

เพิ่ม `periods: LineAiPeriodCandidate[]` ใน `LineAiValueCandidates` (additive; gateway เก่าไม่รู้จักและไม่พัง) คำนวณจากข้อความ + `todayIso` (วันปฏิทิน Asia/Bangkok) โดยโค้ดเท่านั้น:

```
LineAiPeriodCandidate = {
  span: string;                      // ข้อความต้นฉบับที่อ่านมา
  kind: 'day'|'week'|'month'|'quarter'|'year'|'range'|'last_n_days';
  fromDate: string; toDate: string;  // ISO ค.ศ. ทั้งคู่ inclusive
  monthKey?: string;                 // 'YYYY-MM' เมื่อ kind='month'
  source: 'relative'|'explicit'|'named_month';
  label: string;                     // ไทย เช่น "เดือนที่แล้ว (ส.ค. 2569)"
  assumptions: string[];             // เช่น 'week_monday_sunday', 'year_read_be', 'day_before_read_as_yesterday'
}
```

คำศัพท์ขั้นต่ำ (ไทย + อังกฤษ, ไม่สนช่องว่าง/ตัวสะกดย่อทั่วไป):

| กลุ่ม | ตัวอย่างที่ต้องอ่านได้ | ผล |
| --- | --- | --- |
| วัน | วันนี้/today; เมื่อวาน/เมื่อวานนี้/yesterday; **วันก่อน** (อ่านเป็นเมื่อวาน + assumption); เมื่อวานซืน/day before yesterday; N วันก่อน/N days ago | `day` |
| หลายวันล่าสุด | 3 วันที่ผ่านมา, 7 วันล่าสุด, last 7 days, 30 วันย้อนหลัง | `last_n_days` (สิ้นสุดวันนี้, N ≤ 366) |
| สัปดาห์ | สัปดาห์นี้/อาทิตย์นี้/this week; สัปดาห์ที่แล้ว/อาทิตย์ที่แล้ว/สัปดาห์ก่อน/อาทิตย์ก่อน/last week; N สัปดาห์ที่แล้ว | `week` = จันทร์–อาทิตย์ (Bangkok) |
| เดือน | เดือนนี้/this month; เดือนที่แล้ว/เดือนก่อน/last month; N เดือนที่แล้ว (N ≤ 24); ชื่อเดือน (สิงหาคม, ส.ค., Aug, August) ± ปี (2568, 68, 2025, 25) — ไม่มีปี = เดือนนั้นครั้งล่าสุดที่ไม่อยู่ในอนาคต | `month` + `monthKey` |
| ไตรมาส | ไตรมาสนี้/ไตรมาสที่แล้ว/Q1–Q4/ไตรมาส 1–4 (± ปี) | `quarter` (ปฏิทิน) |
| ปี | ปีนี้/this year; ปีที่แล้ว/ปีก่อน/last year; ปี 2568 / 2025 | `year` (ปฏิทิน ไม่ใช่ปีบัญชี) |
| ช่วงตรง ๆ | 1–15 ก.ย., ตั้งแต่ 1 ถึง 15 กันยายน, 1/9–15/9/68, from 1 to 15 Sep | `range` (ใช้ date candidate เดิม 2 ตัวที่ไม่กำกวม) |

- ปี: ≥ 2400 = พ.ศ., สองหลักตามกติกาเดิมของ normalizer (ชื่อเดือนไทย → พ.ศ., อังกฤษ → ค.ศ.); ช่วงที่กำกวม (สองหลักไม่มีชื่อเดือน) → assumption `ambiguous_two_digit_year` และไม่ใช้อัตโนมัติ (เหมือน date เดิม)
- อนาคต (พรุ่งนี้, เดือนหน้า, ปีหน้า) **ไม่ออก candidate** สำหรับการอ่านข้อมูล (ไม่มีข้อมูล) — โมเดล/tool ใช้ default และคำตอบระบุช่วงที่ใช้; ไม่เดา
- คำที่ตีความไม่ได้ชัด (ต้นเดือน, ปลายเดือน, ช่วงนี้, เร็ว ๆ นี้) ไม่ออก candidate → default เดือนปัจจุบัน + คำตอบระบุช่วง
- หลาย candidate ในข้อความเดียว (เช่น "เมื่อวานกับเดือนที่แล้ว") ออกทั้งหมด โมเดลเลือก/แยกเรียกตามเดิม
- recall ชนะ precision (ADR 0011): candidate เกินไม่เป็นไร เพราะเป็นแค่ชุดที่อนุญาต ไม่ใช่คำตอบ

### 3.2 การใช้ candidate ในเส้นทางโมเดล (gateway)

- prompt ของ router/loop: ช่วงเวลาให้เลือกจาก `valueCandidates.periods` **เท่านั้น** (คัดลอก `fromDate/toDate/monthKey` ตรง ๆ) ห้ามคำนวณวันเอง; ถ้าผู้ใช้ไม่ระบุช่วง ห้ามใส่วันที่ (ให้ tool ใช้ default ของตัวเอง = เดือนปัจจุบัน)
- `allowedLoopDates`/`preparedAllowedDates` รวม `fromDate/toDate` ของทุก period candidate; sanitizer whitelist `periodKey` (ต้องเท่ากับ `monthKey` ของ candidate หรือเดือนปัจจุบัน), `newUntil` (ใหม่) และคงกติกา `date/fromDate/toDate` เดิม
- เลน deterministic: `fromDate/toDate/date/periodKey/newSince/newUntil` ที่ตรงกับ candidate หรือวันนี้/เดือนนี้ ผ่านได้ → คำถามที่มีช่วงสัมพัทธ์ตอบสำเร็จรูปได้ (ไม่ต้องถอยไปเส้นทางปกติ) แต่ห้ามลดการตรวจ security เดิม
- ทั้งสองเส้นทางต้องส่งช่วงเดียวกันให้ tool เมื่อข้อความเดียวกัน (พิสูจน์ด้วย test เทียบ input ของ tool)

### 3.3 tool contracts และ default

| tool | input ช่วงเวลา | default เมื่อไม่ระบุ |
| --- | --- | --- |
| `sales.get_sales_summary`, `expense.list_recent`, `accounting.get_summary`, `expense.get_breakdown` | `fromDate/toDate` (มีอยู่) | เดือนปัจจุบัน (ยืนยันในโค้ดแต่ละตัว; ถ้าตัวใดใช้ค่าอื่นให้ปรับเป็นเดือนปัจจุบันตาม decision) |
| `expense.get_daily_closing` | `date` (มีอยู่) — ช่วงที่ยาวกว่าหนึ่งวันใช้ไม่ได้ | วันนี้ (การปิดยอดเป็นรายวัน — ข้อยกเว้นที่ระบุไว้) |
| `tax.get_vat_summary` | **เพิ่ม `periodKey` ใน optionalInputFields** (tool รับอยู่แล้ว) | งวดปัจจุบัน (เดือนปัจจุบัน) |
| `crm.get_customer_summary` | `newSince` (มีอยู่) + **เพิ่ม `newUntil`** (นับที่สร้างใน [since, until] inclusive) | เดือนปัจจุบัน |
| `procurement.get_ap_outstanding`, `inventory.list_low_stock` | ไม่มี (สถานะ ณ ตอนนี้) | คำตอบระบุ "ณ วันที่/ตอนนี้" ตามเดิม |

### 3.4 คำตอบ

- ทุกคำตอบที่มีช่วงเวลาต้องระบุช่วงที่ใช้จริง (มีอยู่แล้วใน formatter/composer — ต้องคงและเพิ่ม test); ช่วงที่มาจากคำสัมพัทธ์ให้พิมพ์ทั้งคำและวันที่ เช่น "เดือนที่แล้ว (1–31 ส.ค. 2569)"
- ถ้าโมเดลใส่วันที่ที่ไม่มี candidate รองรับ → ถูกทิ้ง → tool ใช้ default และคำตอบยังระบุช่วง (ไม่เงียบ)
- telemetry ต่อ turn: `periodSource: 'explicit'|'relative'|'default'` (enum เท่านั้น) ในบรรทัด log ที่มีอยู่ของ prepared lane / loop

## 4. Acceptance

- [x] P-01 ตัวแปลช่วงเวลา: ตาราง test ≥ 40 กรณี (ไทย/อังกฤษ, พ.ศ./ค.ศ./สองหลัก, N-forms, ข้ามเดือน/ปี, ปีอธิกสุรทิน, วันจันทร์-อาทิตย์, today ที่ฉีดเข้า) ตรงตาม §3.1 ทุกกรณี; ไม่มีการเขียนข้อความผู้ใช้ใหม่ — `resolvePeriodCandidates` ใน `packages/contracts/src/line-ai-value-normalizer.ts`; ตาราง 68 แถว + 5 test เพิ่มใน `line-ai-value-normalizer.spec.ts` (contracts 324/324 ผ่าน) ทุกแถวยืนยันว่า `span` เป็น substring ของข้อความเดิม
- [x] P-02 Gateway: sanitizer/allowed dates รับเฉพาะวันที่ที่ candidate รองรับ; วันที่ที่โมเดลคิดเองถูกทิ้ง (test); prompt สั่งเลือกจาก `periods` — `orchestrator.agent.ts` (`periodBackedValues`, `allowedLoopPeriods`, `preparedAllowedPeriods`, `periodKey`/`newUntil`/`newSince` ใน sanitizer), prompt เดียวกันทั้งสอง loop + `FUSED_PLAN_SECTION`; test: วันที่ที่ไม่มี candidate ถูกทิ้งทั้งเลนสำเร็จรูปและ model loop
- [x] P-03 เลน deterministic ตอบคำถามช่วงสัมพัทธ์ได้ (เมื่อวาน/เดือนที่แล้ว/สัปดาห์ที่แล้ว/ปีที่แล้ว/ส.ค. 68) โดย security spec เดิมผ่าน และเส้นทางปกติได้ input เดียวกัน — 5 test ใน `orchestrator.agent.spec.ts` (ยอดขายเดือนที่แล้ว / ค่าใช้จ่ายสัปดาห์ที่แล้ว / ปิดยอดเมื่อวาน / VAT เดือนที่แล้ว / ลูกค้าใหม่เดือนที่แล้ว) + test เทียบ input ของ tool ระหว่างสองเส้นทาง; `prepared-simple-read-security.spec.ts` ไม่ถูกแก้และยังผ่าน
- [x] P-04 `tax.get_vat_summary` ตอบงวดที่ระบุ; `crm.get_customer_summary` นับตามหน้าต่าง [since, until]; default ทุก tool ใน §3.3 = เดือนปัจจุบัน (ยกเว้นปิดยอดรายวัน) — `optionalInputFields` ใหม่ใน `ai-tools.ts`, `erp-crm-tools.use-case.ts` + `summarizeCustomers` รับ `newUntil`, `erp-tax-tools.use-case.ts` ตรวจรูปแบบ `YYYY-MM` เอง; test ครบทั้ง 5 tool ของตาราง §3.3 (`erp-business-tools.use-case.spec.ts` §3.3 default period)
- [x] P-05 คำตอบระบุช่วงที่ใช้ (คำ + วันที่) ทั้งเลนสำเร็จรูปและเส้นทางปกติ — `periodLabel` ส่งผ่าน `PreparedFormatContext` (`ช่วง: เดือนที่แล้ว (1–31 ส.ค. 2569)`) ทุก family ที่มีช่วง + `periodFact` ของ specialist บนเส้นทางปกติ; telemetry `periodSource` อยู่บนทุกบรรทัด log ของเลน (`served`/`fallback`/`honest_terminal`) — loop ไม่มีบรรทัด log ต่อ tool call ให้เติม
- [x] P-06 Corpus: เพิ่มชุดคำถามช่วงเวลา (≥ 8 งาน) ใน corpus เวอร์ชันใหม่ (hash ใหม่ บันทึกไว้) — Bedrock replay ในวงเงินที่ owner อนุญาตแล้ว (เหลือจาก R5) พิสูจน์ว่า tool ได้รับช่วงที่ตรงกับตัวแปล ≥ 90% ของงาน และไม่มี regression ของงานเดิม — corpus v2 (9 งาน, hash `ae237f27…`); replay `h4-period-2026-09-18T10-04-17-532Z` (git `3e65f7a6`): **ตรงกัน 31/33 record = 93.9%** (2 record ที่ไม่ตรงคืองานที่ไม่มีสิทธิ์ `line.ai.query` จึงไม่เรียก tool เลย → ในบรรดา record ที่เรียก tool จริง **31/31 = 100%**); งานเดิม success 22/22 และ routing 22/22 เท่าเดิม ([research §15](../research/line-ai-intake-cost-benchmark-2026-09-17.md#15-h4-period-replay--the-tool-gets-the-period-the-resolver-read-wave-2-h4-2026-09-18))
- [ ] P-07 UAT: ถามจริงบน LINE 5 แบบ (เมื่อวาน, เดือนที่แล้ว, สัปดาห์ที่แล้ว, ปีที่แล้ว, ชื่อเดือน+ปี) ได้ช่วงถูกต้องและคำตอบระบุช่วง (หลัง deploy)

## 5. ไม่ทำ

ปีบัญชี/งวดบัญชีที่ไม่ใช่ปฏิทิน, ช่วงอนาคต, เวลาในวัน (ชั่วโมง), คำกำกวม (ต้นเดือน/ปลายเดือน/ช่วงนี้), AP/สินค้าคงเหลือย้อนหลัง ณ วันที่ในอดีต, การเปลี่ยนโมเดล/ภาษาอื่นนอกจากไทย/อังกฤษ
