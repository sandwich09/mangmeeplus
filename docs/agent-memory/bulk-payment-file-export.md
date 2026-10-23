# Agent Memory: bulk-payment-file-export

Status: READY (docs-first) — reviewed 3 rounds 2026-10-24, no HIGH open; see Must close before coding (spec §12.1, M1–M9)
Owner: thawatchai (เจ้าของ) · lane: รายจ่าย + การเบิกจ่าย
Scope: backlog ข้อ 11 — "ชุดโอน" รวมใบเตรียมจ่ายที่อนุมัติแล้ว + ใบเบิกรอจ่าย → คัดลอกเลขบัญชีทีละรายการ (มือถือ) หรือ **แผ่นงานรายการโอน (Excel) สำหรับกรอก/คัดลอกลงระบบธนาคาร** (Phase 1) / รูปแบบนำเข้า SCB Business Anywhere (Phase 2) / กสิกร KCC+ (Phase 3) → บันทึกผลด้วยไฟล์ผลจากธนาคาร; จุดยืน: ไม่ทำ bank feed ตอนนี้. Baseline main 6c54ba208 (worktree `claude/expense-specs-20261023`, `git diff 6c54ba208 HEAD` ว่าง)

Decisions:
- ไม่โอนเงิน ไม่เชื่อม API ธนาคาร ไม่ดึงรายการเดินบัญชี (Your Data: ประกาศ ธปท. 47/2568 กำหนดข้อมูลเงินฝากนิติบุคคล SME **ไม่ช้ากว่า 31 มี.ค. 2571**; หนังสือเวียน 16 เม.ย. 2569 ผ่อนผันเฉพาะการเปิดเผยบทบาท ไม่ได้เลื่อนกำหนดนี้ — แต่วันที่เชื่อมได้จริงยังไม่มีใครยืนยัน จึงใช้วางแผนรุ่นนี้ไม่ได้ — ทบทวนเมื่อมีผู้ให้บริการ/ธนาคารที่ยืนยันว่าส่งข้อมูลนิติบุคคล SME ผ่าน Your Data ได้จริง ไม่ใช่รอกำหนดวัน; API ธนาคาร = พันธมิตร Q4)
- Phase 1 = แผ่นงานสำหรับกรอก/คัดลอก **ไม่อ้างว่าอัปโหลดตรงได้**; ไม่สร้างไฟล์รูปแบบนำเข้าธนาคารใดจนกว่าจะตรวจกับธนาคารนั้น (การตัดสินใจของผลิตภัณฑ์ — ไม่ใช่ข้ออ้างว่าธนาคารไม่รับไฟล์จากโปรแกรมอื่น)
- จ่ายทุกรายการผ่าน `DisbursementVoucherUseCase.pay` / `RecordReimbursementPaymentUseCase.execute` เดิม + option ภายใน `paymentBatchItem`; ใบเบิกส่ง `batchEvidence` เข้า `recordPaymentAtomic` และตรวจใต้ล็อกการจ่าย
- ล็อก: ชุด (`…:payment-batch`) → ต้นทางเรียง key (voucher `…:disbursement-voucher-lifecycle`; claim `…:reimbursement-payment` → `…:reimbursement-request`) → แถว; ทางเดิมไม่ขอล็อกชุด; ตรวจ freeze ในธุรกรรมของคำสั่งหลังล็อกต้นทาง
- ดาวน์โหลดครั้งแรกตรึงเฉพาะ PENDING (`exportItemCount/TotalAmount/DigestSha256`, `exportAccountCiphertext` ต่อรายการ) ดาวน์โหลดซ้ำจากค่าตรึง ciphertext ตรึงลบเมื่อชุดจบ
- `sourceVersion` = ลายนิ้วมือข้อมูลการจ่าย (ไม่ใช่ `version` ดิบ) → แนบสลิปใบเตรียมจ่ายระหว่าง FILE_READY ได้
- ผลต่อแถวสามสถานะ (ยังไม่ทราบผล/สำเร็จ/ไม่สำเร็จ) ตัดสินใต้ล็อกต้นทาง+แถว; ชนกัน → การจ่าย rollback; รอบบันทึกผลมี lease 10 นาที; `PaymentBatchCommand` เก็บ fingerprint/ผล
- ไฟล์ผลจากธนาคาร: รั้วเดียวกับสลิป (ดาวน์โหลดทั่วไป/ลบ/ผูกซ้ำ/เสนอแนบ/ตรวจใบเสร็จ/ลายเซ็น) ไม่ผูกเป็นสลิปของใบใด; ไฟล์ของใบเตรียมจ่ายก็ไม่เป็นใบเสร็จใบเบิก (B4, `NOT_PAYMENT_EVIDENCE_WHERE`)
- ลำดับล็อกเดียว: ① advisory ชุด → ② advisory ต้นทาง → ③ แถว PaymentBatch → ④ แถว item; hook ในธุรกรรมการจ่ายแตะเฉพาะ ④ (การจ่ายใบเบิกเป็น Serializable `prisma-reimbursement.repository.ts:3828`); ปิดชุดด้วย `closeBatchIfDone` ธุรกรรมแยก; ตัววนผลลองใบเบิกใหม่ ≤3 ครั้ง
- preflight ของ use-case ใบเบิก (`:463`) นับหลักฐานชุดแบบอ่านอย่างเดียว; ข้อตัดสินจริงใต้ล็อกใน `recordPaymentAtomic`
- ยกเลิก (`:id/cancel`, ไม่มี PAID) / ปิด (`:id/close`, DRAFT มี PAID+PENDING): เฉพาะรายการที่ยังไม่จ่ายออก; ป้าย CLOSED = "ปิดแล้ว" และ "บันทึกผลครบแล้ว" เฉพาะเมื่อไม่มีรายการออกตอนปิด; การดาวน์โหลดไม่ใช่ replay และชุดที่จบแล้วดาวน์โหลดไม่ได้
- หน้าเว็บ `/payment-batches…` อยู่ใน `ROUTE_PERMISSION_RULES` (anyOf สิทธิ์จ่ายสองแบบ)
- ทุกรายการที่ได้ผลเก็บ `resultAttachmentId` + `resultsCommandId`
- อำนาจจ่ายตรวจตรง (ไม่อิงชื่อกลุ่ม reveal); ไม่มีสิทธิ์/เมนู/สวิตช์ใหม่; ทุกแพ็ก 249/499/999/1999
- e-WHT: ใบที่มีรายจ่าย `whtRemittance = 'E_WHT'` (spec `docs/specs/e-withholding-tax-payment-spec.md`) ไม่เข้าแผ่นงาน (`ewht`) — งานที่ลงทีหลังเติมกติกานี้
- Module ใหม่ `apps/api/src/modules/payment-batches/`; ล็อก/hook เป็นฟังก์ชันธรรมดารับ tx
- Test ฝั่ง API ใส่ไฟล์ที่ลงทะเบียนแล้ว: `banking.logic.spec.ts`, `banking.dtos.spec.ts`, `prisma-expense.repository.payment.spec.ts`, `reimbursement-finance.use-case.spec.ts`, `reimbursement-request.use-case.spec.ts`, `prisma-attachment.repository.spec.ts`, `line-draft-update.security.spec.ts`, PG `prisma-reimbursement.repository.draft-submit-race.spec.ts`; manifest spec ลงทะเบียนใน whole-chain catalog (`:398`)
- หน้าจอตรวจที่ 390, 1280, ≥1536 px + ภาพหน้าจอที่ดูแล้ว

Open questions (owner, spec §17 — คำแนะนำในวงเล็บ):
- Q1 รูปแบบเฉพาะธนาคารแรก (SCB Business Anywhere; ขอไฟล์แม่แบบจริงหนึ่งชุด)
- Q2 ใบเบิกที่จ่ายผ่านแผ่นงานใช้ไฟล์ผลของชุดแทนสลิปรายใบ (ได้ — ตรวจใต้ล็อกการจ่าย)
- Q3 สิทธิ์แยกสำหรับดาวน์โหลด (ไม่ต้อง)
- Q4 เป็นพันธมิตรธนาคารตอนนี้ (ยังไม่)
- Q5 ใส่เบอร์/อีเมลผู้รับ (ไม่ใส่)

Artifacts:
- `docs/specs/bulk-payment-file-export-spec.md`
- `docs/plans/bulk-payment-file-export-plan.md`
- this file

Findings recorded in spec:
- B1 (กลาง): API ใบเตรียมจ่ายไม่กันเลขบัญชีในช่องชื่อ ไม่จำกัดความยาว และทางคัดลอกบัญชียกชื่อเดิมโดยไม่ตรวจ (`disbursement-voucher.use-case.ts:44-60`, `:115-126`, `:201-211`); เว็บจำกัดความยาวแล้ว (`DisbursementVoucherAccountFields.tsx:66`, `:69`)
- B2 (ต่ำ): เปิดเลขบัญชีใบเตรียมจ่ายได้ทุกสถานะ (`:159-172`); แก้ต้องคง PDF ฉบับปิดบัง (`:344-349`)
- B3 (ต่ำ ไม่ได้ขาย): statement import `preset` ไม่ถูกใช้ + เว็บไม่รับ XLSX
- B5 (ต่ำ, รอบ 3): การจ่ายรายจ่าย/ใบเตรียมจ่ายไม่ตรวจงวดบัญชีที่ปิด (`prisma-expense.repository.ts:670-723`) → Phase 0.4; อะตอมกับการปิดงวด = M8
- B6 (ต่ำ, รอบ 3): ทางคัดลอกบัญชี (`disbursement-voucher.use-case.ts:201-211`) ข้ามกติกาสถานะ/เจ้าของ → Phase 0.2
- B7 (ต่ำ, รอบ 3): ชื่อผู้รับจาก fallback ชื่อผู้ขาย (`:108`) ไม่ถูกตรวจ → Phase 0.1
- B4 (กลาง, รอบ 2): ไฟล์ของใบเตรียมจ่ายถูกเสนอ/บันทึกเป็นใบเสร็จใบเบิกได้ แล้วผูกเข้ารายจ่ายตอนอนุมัติไม่ได้ (`reimbursement-evidence.service.ts:37-43`, `line-reimbursement-draft-adapter.service.ts:797-802` vs `attachment.logic.ts:97-98`, `prisma-reimbursement.repository.ts:2388-2391`) → Phase 0.3
- G-1…G-11 ใน spec §12

External research:
- ยืนยันเอง (23–24 ต.ค.): หน้าคู่มือ SCB BA, FlowAccount×KBank (บทความ + หน้าเชื่อมต่อ), Krungsri Fund Transfer API, ข่าว ธปท. 2 มิ.ย. 2569
- ผู้ช่วยค้นยืนยัน: KCC+ upload-failed/condition PDFs, SCB upload manual, BBL direct credit/PromptPay pages, Krungsri/KTB manuals, ITMX, ประกาศ ธปท. 23/2569
- ผู้ตรวจ/ผู้ประสานงานอ้าง (ผู้เขียนเปิดได้แต่อ่าน PDF ไม่ได้ หรือหมดเวลา): BBL batch-transfer help, KBank enable-macro PDF, SCB PromptPay import manual 2026-06-26 (Corporate ID / System Reference ID), PDPA 2562 ที่ MDES, ธปท. ว. 2409/2569
- ต้องมีหลักฐานปัจจุบัน: K BIZ 10 รายการ/ไม่มีอัปโหลด (คู่มือ ก.ค. 2567), K APi สำหรับ SME, ค่าธรรมเนียมปัจจุบันของ SCB/K BIZ
- ผู้ช่วยค้นข้อมูลรอบแรกเปิด PDF ในเบราว์เซอร์ในแอปจนมีหน้าต่างบันทึกไฟล์เด้งบนจอเจ้าของ — ห้ามใช้เบราว์เซอร์ในแอปกับงานนี้ ใช้ WebFetch/WebSearch เท่านั้น
- เครื่องนี้ไม่มี pdftotext/pdftoppm อ่าน PDF บีบอัดไม่ได้

Review 2026-10-24 (Codex gpt-6-astra ultra: "unsafe to build"; ผู้ประสานงานเปิดทุก citation โค้ดแล้วถูกต้อง) — ทุกข้อแก้แล้ว:
- F1 ไฟล์ผลได้รั้วสลิปครบสี่ด้าน → spec §5.7, §11; plan 1.6
- F2 serialize ผลต่อแถวใต้ล็อกต้นทาง+แถว; ชนกัน → การจ่าย rollback; lease รอบ → spec §5.6; plan 1.3, 1.7
- F3 ตรวจ freeze ในธุรกรรมการจ่ายหลัง `:3645`; ดาวน์โหลดขอล็อกต้นทางเดียวกัน → spec §5.5; plan 1.5, 1.7
- F4 แผ่นงาน = PENDING ตอนตรึง + `exportTotalAmount` → spec §5.2, §5.4, §15.4
- F5 CHECK ยอม CLOSED ไม่มีข้อมูลดาวน์โหลด → spec §6, §9.1
- F6 `batchEvidence` เข้า `recordPaymentAtomic` ตรวจใต้ล็อก แทน `:3706` → spec §5.6, §7.3; plan 1.7
- F7 preview โหมด `evidence: 'deferred'` → spec §5.1, §7.3; plan 1.4
- F8 อำนาจจ่ายตรง ไม่อิงชื่อกลุ่ม reveal → spec §5.7, §8; plan 1.5
- F9 ลายนิ้วมือแทน `version`; `attachSlipAtomic` ไม่ทำให้รายการเสีย → spec §5.5; plan 1.2, 1.7
- F10 ciphertext/ค่าตรึงต่อรายการ ลบเมื่อชุดจบ → spec §5.5, §5.7, §6
- F11 `PaymentBatchCommand` + `lastRefusal*` คงทน → spec §5.6, §6; plan 1.4
- F12 ตรวจชื่อที่บันทึกแล้วและทางคัดลอก (`:201-211`) → spec §5.1, §13 B1; plan 0.1
- F13 PDF ใบยกเลิกคืนฉบับปิดบัง (`:348`) → spec §13 B2; plan 0.2
- F14 สามสถานะผล ส่งเฉพาะแถวที่เลือก → spec §5.6, §10.3; plan 1.9b
- F15 แผ่นงานสำหรับกรอก/คัดลอก ไม่อ้างการอัปโหลด → spec §0, §5.4, §10.3, §10.7
- F16 `refusal()` + `webPath` ที่ทุกจุดคืน refusal → spec §7.5; plan 1.8
- F17 การ์ดใช้ปุ่มเปิดคู่มือ (ป้าย = ชื่อการ์ด) + map `payment-batches`→`expenses` → spec §10.5; plan 1.10
- F18 SCB Corporate ID / System Reference ID ใน Phase 2 → spec §5.4, §5.9, G-1; plan 2.1
- F19 KBank template: ตรวจเส้นทางสาธารณะ ไม่ใช่ "ของลับ" → spec §5.9, G-2; plan 3.1
- F20 ลบข้ออ้างว่าทุกธนาคารต้องแปลงผ่านแม่แบบหลังล็อกอิน; Excel-only เป็นการตัดสินใจ → spec §3, §5.9
- F21 อ้าง PDPA 2562 จาก MDES แทนบทความร่างปี 2557 → spec §5.7
- F22 ตรวจ 1280 px + ภาพหน้าจอ → spec §10, §14, §15.15; plan ทุกขั้นเว็บ
- F23 ตัวอ่านไฟล์ผลใหม่ตรวจสิทธิ์ชุด ไม่ใช้ `ExtractStatementFileUseCase` → spec G-9; plan 3.2
- F24 K BIZ 10 รายการ = ต้องหลักฐานปัจจุบัน → spec §5.9, G-11
- F25 24% = ส่วนแบ่งสินเชื่อ SME → spec §5.9
- F26 manifest spec อยู่ใน whole-chain catalog → spec §14; plan 1.10
- F27 B1 เหลือเฉพาะ API (เว็บมี `maxLength={140}`) → spec §13; plan 0.1
- F-BOT (ผู้ประสานงาน) ธปท. ว. 2409/2569 ผ่อนผันการเปิดเผยบทบาท Your Data ของนิติบุคคล SME ไม่มีวันใหม่ → spec §5.10 (ถ้อยคำแก้ในรอบ 2 F7: ไม่ได้เลื่อนกำหนด 31 มี.ค. 2571)
- เพิ่มเอง: "นำออก"/"ยกเลิกชุด" แสดงตรง ไม่ซ่อนในเมนู (`docs/guidelines/thai-ux-standard.md:70`); "ยอดในแผ่นงาน" แสดงเฉพาะเมื่อต่าง (`:80`)

Review round 2 (2026-10-24) — Codex ultra: 22/27 RESOLVED, P1/P6/P16/P17/P23 PARTLY, 11 ใหม่ (F1 HIGH); ผู้ประสานงานตรวจ citation ใหม่แล้วถูกต้อง:
- P1 + F3 (B4 ใหม่): ไฟล์ใบเตรียมจ่าย/ไฟล์ผลชุดถูกตัดจากการตรวจใบเสร็จ (`reimbursement-evidence.service.ts:37-43`) และตัวเลือกไฟล์ร่างใบเบิก LINE (`:802`) → spec §1.7, §5.7, §13 B4; plan 0.3, 1.6
- P6 + F1 (HIGH): preflight ของ use-case ที่ `reimbursement-finance.use-case.ts:463` นับหลักฐานชุด (อ่านอย่างเดียว) ไม่ใช่แก้แค่ repository → spec §5.6, §7.3, §15.18; plan 1.7
- P16: ตัวส่งข้อความต่อเนื่องสองทางใน `process-line-webhook.use-case.ts` (`:6776-6785`, `:9779-9784`) พาปุ่ม/ป้าย → spec §7.5; plan 1.8
- P17: ตัวสร้างการ์ดใน `product-help-draft-cards.ts:3-13` รับ path/ไฟล์/hash ของคู่มือ → spec §10.5; plan 1.10
- P23: ตัวอ่านไฟล์ผลต้องมีชั้นสกัดใหม่ (ข้อความพร้อมตำแหน่ง + ตัวแยกผลต่อธนาคาร) และสิทธิ์ของชุด → spec G-9; plan 3.2
- F2: ลำดับล็อกเดียว ①→②→③→④ + เคสแข่ง จ่าย/นำออก/ยกเลิก/จ่ายสุดท้ายพร้อมกัน → spec §5.5, §7.4, §14; plan 1.3
- F4: `resultAttachmentId` + `resultsCommandId` ต่อรายการ → spec §5.6, §6; plan 1.7
- F5: ดาวน์โหลดแยกจาก replay; ชุดจบแล้ว 409 `payment_batch_file_unavailable` → spec §5.6, §9.1, §10.3; plan 1.4, 1.5
- F6: บัญชีแนะนำไม่มาจากใบยกเลิก/ร่างคนอื่น + `canReveal` จาก API (`prisma-disbursement-voucher.repository.ts:104-115`, `DisbursementVoucherAccountFields.tsx:30-41`) → spec §13 B2; plan 0.2
- F7: Your Data แยก "กำหนดไม่ช้ากว่า 31 มี.ค. 2571 (ประกาศ 47/2568)" ออกจาก "ผ่อนผันการเปิดเผยบทบาท (16 เม.ย. 2569)" → spec §5.10, Q4; memory Decisions
- F8: ยกเลิก/ปิดชุดหลังจ่ายบางรายการ: เฉพาะรายการที่ยังไม่จ่ายออก (ปุ่ม "ปิดชุด") → spec §5.6, §9.1, §10.3, §10.7
- F9: ถอดคำถาม "เชื่อมธนาคารอัตโนมัติ" จากการ์ดที่ตอบ "ได้ค่ะ"; การ์ดแยกตอบ "ยังไม่ได้ค่ะ" → spec §10.5, §10.7
- F10: `bankCode` มีแล้วในบัญชีธนาคารร้านและบัญชีผู้ขาย (`schema.prisma:6939`, `:6243`, seed `'004'`) — แคบลงเป็นบัญชีรับเงินของใบเตรียมจ่าย/ใบเบิก → spec §1.3
- F11: แหล่งรหัสธนาคารหลัก = ตารางสมาชิกที่กสิกรเผยแพร่ (2026-06-23, ผู้ประสานงานยืนยันว่าเปิดได้; ผู้เขียนอ่าน PDF ไม่ได้) ยังต้องเทียบแม่แบบ SCB → spec §5.3
- ค้างเป็น MEDIUM/LOW ที่เอกสารปิดไม่ได้: spec §12.1 M1–M7 (Q2, ตัวบท PDPA, ตัวประกาศ ธปท., รหัสธนาคาร vs แม่แบบ SCB, ตัวอย่างไฟล์ผลจริง, เวลาล็อก 100 ต้นทาง, spec ที่ไม่ลงทะเบียน)

Review round 3 (2026-10-24) — Codex ultra: 34/38 RESOLVED, P25/P29/P34/P35 PARTLY, 9 ใหม่, ไม่มี HIGH, ทุกไฟล์ "needs fixes" (รอบสุดท้าย) — แก้แล้วทั้งหมด:
- F1: กติกางวดบัญชี/วันอนาคตของการจ่ายผ่านชุดระบุตามจริง; ใบเตรียมจ่ายไม่ตรวจงวด = B5 (Phase 0.4); ใบเบิกตรวจก่อนธุรกรรมเท่านั้น → ย้ายเข้าในธุรกรรม; อะตอมกับการปิดงวด = M8 → spec §5.2, §13 B5
- F2: ทางคัดลอกบัญชีใช้กติกาเดียวกับ reveal = B6 → spec §13; plan 0.2
- F3 + P29: ใบเบิกเป็น Serializable — hook แตะเฉพาะแถว item, ปิดชุดในธุรกรรมแยก, ลองใหม่ ≤3, ความปลอดภัยของการตรึงมาจาก FOR UPDATE แถว item → spec §5.5, §7.4, §14; plan 1.3, 1.7
- F4: `POST :id/close` + `ClosePaymentBatchInput` + `actions.close`/`droppedOnClose` → spec §7.1–7.2, §9.1; plan 1.4
- F5 + P35: ป้าย CLOSED "ปิดแล้ว"; "บันทึกผลครบแล้ว" เฉพาะเมื่อไม่มีรายการออกตอนปิด; ข้อความปิดชุดบอกจำนวนที่กลับไปรอจ่าย → spec §10.3, §10.7
- F6: test B4 ย้ายไป `prisma-reimbursement.repository.draft-submit-race.spec.ts` (ใน package.json); ระบุว่า `reimbursement-evidence.service.spec.ts` และ `line-reimbursement-draft-adapter.pg.spec.ts` อยู่แค่ใน catalog → spec §14, §12.1 M7; plan 0.3
- F7: เพิ่ม `/payment-batches` ใน `ROUTE_PERMISSION_RULES` → spec §11; plan 1.9a
- F8: ตรวจชื่อผู้รับค่าสุดท้ายหลัง fallback = B7 → spec §13; plan 0.1
- F9 + P25: กสิกร 28% ของยอดสินเชื่อ SME คงค้าง ณ 1Q26 (เอกสารนักลงทุน 2Q26 หน้า 29) แทน 24% → spec §5.9; M9 (ยังไม่ได้อ่าน PDF เอง)
- P34: เงื่อนไขทบทวน bank feed = มีผู้ให้บริการที่ยืนยันว่าเชื่อม Your Data นิติบุคคล SME ได้จริง → spec §5.10

Verification:
- เอกสารอย่างเดียว ไม่มีโค้ดเปลี่ยน; ไม่ได้รัน test/build (ไม่มี node_modules)
- เลขบรรทัดใหม่ (รอบ 1 และ 2) ตรวจด้วย grep บน worktree 2026-10-24

Next:
1. เจ้าของตอบ Q1–Q5
2. ปิดรายการ spec §12.1 ตามขั้นที่ระบุ
3. Phase 0 (B1, B2, B4, B5, B6, B7) — ทำได้ทันที
4. Phase 1 ตามลำดับใน plan (1.7 ส่วนสลิปรอ Q2)
5. Phase 2 เมื่อได้แม่แบบ SCB จริง (G-1)
