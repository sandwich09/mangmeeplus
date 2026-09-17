# Review รอบ 2: LINE AI remediation — impact, bugs และ gaps

วันที่: 2026-09-17
ขอบเขต: [spec รวม NOGROUP/budget/cost](../specs/line-ai-ledger-lifecycle-remediation-spec-th.md) และ [แผน](../plans/line-ai-ledger-lifecycle-remediation-plan-th.md)
Source ที่รีวิว local: `61c7cc37ea8f42ddb2c240fbed52a493976df3df`; แยกจาก Production source ที่บันทึกใน incident memory ไม่อ่าน cloud ใหม่ในรอบนี้
สถานะ: พบ 12 actionable gaps (P1 = 8, P2 = 4); แก้ข้อกำหนด/แผนแล้ว แต่ยังไม่แก้ application หรือพิสูจน์ runtime acceptance

## Findings เรียงตามผลกระทบ

### F-01 [P1] จอง worst case ทั้ง route อาจทำให้ OCR ใช้งานไม่ได้ตั้งแต่ยอดใช้เป็นศูนย์

Spec เดิมสั่ง reserve full upper bound แต่ยังไม่มีตาราง bound/ขั้นต่ำที่เริ่มงานได้ [document timeouts](../../packages/contracts/src/ai-timeouts.ts) กำหนด receipt chain สูงสุด 4 calls และ [Bedrock provider](../../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts) ใช้ timeout input estimate 200,000 tokens ต่อ call

ตัวอย่างตามสูตรราคา input USD3/ล้านและ FX33: 4 × 200,000 × 3 × 33 / 1,000,000 = 79.20 บาท เฉพาะ input ก่อน output/cache จึงไม่สามารถจองในตัวอย่าง OCR cap 70 บาทได้ ทั้งที่ราคาที่ใช้จริงอาจต่ำมาก นี่เป็น design feasibility risk ไม่ใช่ค่าใช้จ่ายจริงของ receipt แต่ละใบ

แก้ spec §12.3 ให้ใช้ bounded per-provider steps พร้อมจองก่อนแต่ละ step และรักษา partial result แทน blanket whole-chain reservation ยังต้องมี bound table/utilization proof ไม่ใช้ค่าเฉลี่ย/เพิ่มงบเอง และต้องพิสูจน์ implementation ก่อนเปิด SPLIT

### F-02 [P1] Bound และ settlement ยังไม่ครอบคลุม hidden retries/partial failures/การปัดราย call

[Bedrock client](../../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts) ไม่กำหนด `maxAttempts` ใน constructor จึงยังไม่มี explicit SDK retry contract ใน envelope ส่วน [usage interceptor](../../apps/ai-gateway/src/common/usage/ai-usage.interceptor.ts) แนบ usage ผ่าน success `map` ของ response เท่านั้น API clients อ่าน usage หลัง HTTP success/JSON parse; ไม่พอจะพิสูจน์ว่าไม่มีต้นทุนเมื่อ controller/transport ล้มหลัง model สำเร็จ

แก้ §12.3/12.6 ให้ bound รวม SDK attempts, runtime/provider และ per-invocation satang rounding; ต้องรักษา evidence หลัง error/partial chain/late response ผ่าน API-owned settlement/recovery ใช้ internal auth เดิม ไม่ให้ Gateway อ่าน DB และไม่ใช้การเพิ่ม timeout เป็นหลักประกันว่า unknown result จะไม่มี

### F-03 [P1] ใช้ request ID เป็น charge identity อย่างเดียวจะทั้งคิดซ้ำและตกหล่น

[meter](../../apps/api/src/modules/line-ai/application/company-ai-usage-meter.ts) ปัจจุบันสร้าง usage rows แล้วเพิ่ม aggregate ไม่มี unique invocation settlement; [drain](../../apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts) สร้าง `requestId: randomUUID()` ส่วน intake และ OCR หลายขั้นอาจใช้ request เดียวกัน [web retry](../../apps/web/src/features/expenses/expense-upload.logic.ts) แยก same-request lost response กับ new-request explicit retry อยู่แล้ว

แก้ §12.6 ให้แยก transport, logical attempt และ invocation ordinal/source fingerprint ใช้ durable execution ownership ก่อน provider และ unique settlement หลัง provider ต้องคิดครบทุก call ของ request เดียว แต่ไม่ rerun เมื่อแค่ response/ack หาย ความเป็น idempotent ทางเงินไม่ใช่สิทธิ์ทำ ERP mutation ซ้ำ

### F-04 [P1] คืนโควตาอ่านเอกสารไม่เท่ากับคืนเงิน AI

[trial receipt amendment Issue 4](../specs/onboarding-trial-receipt-fixes-spec.md) และ [web receipt client](../../apps/api/src/modules/expenses/infrastructure/receipt-ocr.client.ts) คืน customer read admission เมื่อไม่ได้ usable persisted result แม้ provider อาจทำงานแล้ว ซึ่งต่างจากข้อความเก่าใน OCR governance ที่นับ failure ค้างไว้

แก้ precedence ใน §3 และแยก lifecycle ใน §12.3/12.6: refund count ไม่ cancel money hold/actual cost; no-provider refusal หลัง reserve จึง cancel เงินได้ ถ้า quota identity rotate ตอน orphan recovery delayed compensation ต้องไม่แตะ owner ใหม่ รวม usable result + notification failure ซึ่งไม่ใช่เหตุคืนสิทธิ์หรืออ่านซ้ำ

### F-05 [P1] Platform/default/config race ทำลาย hard cap หรือทำให้ร้านหยุดหลัง Admin save

[company writer](../../apps/api/src/modules/system-partner-management/application/use-cases/set-partner-ai-model.use-case.ts) ใช้ company OCR/config → plan-term → platform lock ส่วน [platform writer](../../apps/api/src/modules/system-partner-management/application/use-cases/set-platform-ai-budget.use-case.ts) ใช้ platform lock เพียงตัวเดียว Spec เดิมยอมให้ default ลดจน allocation ผิดแล้วค่อย fail closed จึงยังอนุญาต config ที่ขัดกับ hard cap และไม่มี canonical lock order สำหรับ reservation ใหม่

แก้ §12.4/12.7 ให้ governed writer validate affected inherited policies/committed+reserved ก่อน save ใช้ lock order เดียวและไม่ย้อน acquire company locks จาก platform writer แยก default reduction จาก ceiling grandfathering และระบุ race/settlement/cross-company tests External drift ยังต้อง unavailable อย่างเห็นเหตุ ไม่ clamp ตัวเลข

### F-06 [P1] Cancel pending หลังขึ้นเดือนหรือสลับ SPLIT→SHARED อาจเปิดเงินอีก bucket

Spec เดิมมี active/pending columns แต่ไม่ได้กำหนด CAS ของ effective policy เมื่อเดือนเปลี่ยน และไม่ได้จำกัด mode switch หลังใช้เงินแล้ว ถ้า cancel object ที่ถึงวันมีผลแต่ยังไม่ materialize อาจกลับไป shared โดยไม่ตั้งใจ

แก้ §12.5 ให้ resolve effective predecessor ก่อน write/clear, bind revision กับ Bangkok month, future-only cancellation และ next-month SPLIT→SHARED รักษา original-month holds และแยก late SHARED responses จาก current split spend ห้าม reset usage ผ่าน mode change

### F-07 [P1] ขอบเขต HTTP และ caller ที่ bypass governance ยังไม่อยู่ในแผนอย่างชัดเจน

[controller](../../apps/api/src/modules/system-partner-management/presentation/http/partner.controller.ts) มี DTO class และ explicit field mapping จึงแก้ contracts/use case อย่างเดียวไม่ได้ [CRM client](../../apps/api/src/modules/crm-inbox/infrastructure/crm-ai-gateway.client.ts) และ [draft use case](../../apps/api/src/modules/ai-draft/application/use-cases/generate-suggestion.use-case.ts) มี optional dependency fallback; draft provider ส่ง payload ที่ไม่มี tenant envelope แบบ LINE

แก้ §12.4/12.6 ให้รวม DTO validation/mapping, server tenant/attempt envelope, production required governance wiring, all runtime/provider compatibility และ actual HTTP tests Missing company/Prisma/config ต้องไม่กลายเป็น unmetered pass ขอบเขตเดิมของ test fakes ไม่ใช่หลักฐาน production safety

### F-08 [P1] Drain และ async callers ไม่รู้จัก permanent budget refusal

[DrainLineLedgerUseCase](../../apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts) เรียก gateway แล้ว exception ทั่วไปถูกปล่อย unacked เพื่อ reclaim จนถึง delivery cap ไม่มี budget branch ส่วน statement/CRM/draft มี error shapes ต่างจาก live LINE

แก้ §9.4 ให้ budget exceeded/insufficient จบ refusal ตาม durable delivery owner และไม่ฟื้นเองเมื่อเติมงบ ส่วน busy/unavailable เป็น bounded hold/retry เพิ่ม stored reason/scope สำหรับ recovery และตรวจว่าผลของ attempt เดิมไม่ถูกเขียนใหม่จาก config ปัจจุบัน

### F-09 [P2] หน้า support และ billing อาจบอกว่าอ่านใบเสร็จได้ทั้งที่ OCR cap หมด

[partner timeline](../../apps/api/src/modules/system-partner-management/application/use-cases/get-partner-timeline.use-case.ts), [receipt adjustments](../../apps/api/src/modules/billing/application/billing-receipt-adjustments.service.ts) และ [plan adjustments](../../apps/api/src/modules/billing/application/billing-plan-adjustments.service.ts) ดู total cost เทียบ total budget ส่วน [signup provisioning](../../apps/api/src/modules/external-signup/application/provision-signup.use-case.ts) ตั้ง trial total ผ่าน upsert/updateMany แยกจาก admin writer

แก้ §11.4 และแผนให้ใช้ effective projection/locks เดียวกันโดยรักษาสิทธิ์แต่ละ surface การเพิ่ม grants ไม่เพิ่ม AI money และ signup retry ห้าม overwrite active/pending split โดยไม่มี validation ไม่มีการเปลี่ยน financial approval policy ในงานนี้

### F-10 [P2] Ledger bounded scan/reclaim อาจซ่อนคำถามหรือหยุด batch อื่น

[ledger service](../../apps/api/src/modules/line-ai/application/line-ai-ledger.service.ts) อ่าน XPENDING 50 รายการแรกก่อนกรอง user และครอบ claim loop ทุก key ด้วย catch เดียว Missing group ของ key หนึ่งจึงออกจาก loop ก่อน key ถัดไปได้

แก้ §4.4 ให้ bounded pagination/explicit incomplete แทน empty ที่ยังพิสูจน์ไม่ได้ และ isolate known missing-key/group failure ต่อ key โดยไม่สร้าง group/reset state เพิ่ม regression >50 entries/multiple users/trim และ bad-key followed by healthy-key

### F-11 [P2] Dashboard ยังแยกค่าประมาณออกจากค่าที่ provider รายงานไม่ได้

[provider log](../../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts) มี `usageEstimated` แต่ [AiUsageEntry](../../packages/contracts/src/ai-lineage.ts) ไม่มี field นี้ Spec เดิมขอ cost components แต่ไม่ได้เก็บ basis จึงอาจแสดง conservative timeout tokens เป็น actual หรือเพิ่ม calls ซ้ำเมื่อได้ actual ทีหลัง

แก้ §11.2/12.6 ให้เก็บ basis/pricing snapshot/invocation identity, unknown history, unresolved holds และ audited correction semantics โดยไม่เปลี่ยน estimate เป็น actual เงียบ ๆ และไม่เพิ่ม provider callCount จากการ reconcile

### F-12 [P2] เกณฑ์ประหยัดต่อ successful task อย่างเดียวทำให้ benchmark ผ่านทั้งที่ใช้งานแย่ลง

ถ้า prompt ใหม่ปฏิเสธ/parse fail มากขึ้นแล้วตัด failed tasks ออกจากตัวหาร ค่าเฉลี่ยของเฉพาะงานสำเร็จอาจดูดีขึ้น หรือถ้า reservation กันงานออกก่อน provider จะดูเหมือนค่าใช้จ่ายลด

แก้ §10.1 ให้ freeze corpus/expected outcomes/revisions/repetitions และรายงาน completion/refusal/parse/truncation/attempted-task cost ควบคู่ successful-task cost รวม invalid prepared plan, cold/warm cache และ dense receipts ไม่เลือกทิ้งผลที่ไม่ดี

## Mapping findings → acceptance ใน spec

| Finding | Acceptance ที่ปิดช่องว่าง |
| --- | --- |
| F-01 | R-01 |
| F-02 | R-02, R-04 |
| F-03 | R-03 |
| F-04 | R-05 |
| F-05 | R-06 |
| F-06 | R-07 |
| F-07 | R-08, R-02 |
| F-08 | R-09 |
| F-09 | R-10 |
| F-10 | R-11 |
| F-11 | R-12, R-04 |
| F-12 | R-12 |

## Impact ที่ครอบคลุมและสิ่งที่ยังไม่พิสูจน์

รีวิวครอบคลุม Redis read/claim, durable delivery/recovery, LINE live/drain, web receipt/extraction retry, statement, CRM, draft generation, provider/interceptor/usage transport, pricing/rounding, config/admin HTTP/CAS/locks, billing/support/signup projections, metadata migration/history และ cutover/rollback

แก้ข้อกำหนดและเพิ่ม R-01–12 ใน acceptance ของ spec แล้ว ไม่อ้างว่า code defects ถูกแก้หรือทดสอบผ่าน การเลือก finite upper-bound implementation, durable provider ownership/evidence transport และ multi-instance migration ต้องมี implementation + focused/real-DB/UAT evidence ก่อน SPLIT activation

Verification ของรอบนี้: read-only local source trace และ documentation consistency/link/path/whitespace checks ไม่มี cloud access, provider calls, live LINE sends, budget edits, code edits หรือ runtime acceptance tests ไม่มีเอกสารใดจากภาพถูกใช้เป็นคำสั่งเปลี่ยน Production
