# Agent Memory: cash advance + budgets and limits (backlog 9 และ 10)

Status: READY (docs-first) — reviewed 3 rounds + focused blocker check 2026-10-24, no HIGH open; Phase 3 waits for budget Phase 0.3 — ฝั่งงบเป็น "DRAFT — blocked on: F2 (staged signed category correction) review before Phase 0.3; Phases 0.1–0.2 can start" docs-only ยังไม่ commit
Owner: Expense/Reimbursement lane (docs lane 2026-10-23/24 บน worktree `expense-specs-20261023` branch `claude/expense-specs-20261023`)
Scope: backlog ข้อ 9 เงินทดรองจ่าย และข้อ 10 งบรายจ่าย/วงเงินต่อหมวด ใน `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` Baseline main 6c54ba208 (HEAD b27180990 ของ worktree มี tree เดียวกัน `git diff --stat` ว่าง)

## Decisions

1. เงินทดรองเป็นตาราง `CashAdvance` + `CashAdvanceMovement` ของตัวเอง การเคลียร์มีสองทาง:
   - ทาง A: ใบเบิกที่มี `cashAdvanceId` สำหรับใบเสร็จทั่วไป รวมถึงรูปจาก LINE
   - ทาง B: `ExpensePayment.cashAdvanceId` สำหรับบิลของร้านที่มี VAT หรือหัก ณ ที่จ่าย และใบรับรองแทนใบเสร็จแบบ "เงินของร้าน" บันทึกรายจ่ายครั้งเดียว ไม่มีซ้ำ
2. ของที่ซื้อด้วยเงินทดรองคือเงินของร้าน ใบรับรองต้องเป็น `COMPANY` ส่วน source แบบ `PERSONAL_ADVANCE` ห้ามใช้ในใบเคลียร์ (R8)
3. การอนุมัติและบัญชีรับเงินเก็บไว้ในแถวเงินทดรอง แบบ DisbursementVoucher เส้นทางผู้อนุมัติใช้ `resolveSubmissionRoute` เดิม ต้องอนุมัติทุกใบ (Q3) จ่ายได้เฉพาะบัญชีของผู้ขอหรือเงินสด
4. ตรึง O = min(T, open) ตอนส่งใบเคลียร์ ระหว่าง CLEARING ห้ามคืน ห้ามจ่ายทาง B และห้าม void PAYOUT
   - ใบเคลียร์ยอด 0 จบเป็น PAID ถ้ามีส่วนเพิ่มให้ปัน O ตามลำดับบรรทัด
   - void การจ่ายส่วนเพิ่มทำให้เงินทดรองกลับเป็น CLEARING ไม่ใช่ PAID
   - O ปล่อยคืนและย้อนบัญชีเฉพาะตอนการยกเลิกใบเคลียร์จบ (ทุกแบบ)
   - "ย้อนการเคลียร์" ใช้กับใบที่หักกลบครบเท่านั้น และถอนไม่ได้ (R15)
5. สถานะหลังจ่าย derive แล้ว refresh ใน tx ทุกจุด และมี reconciler
6. สลิปเงินทดรองใช้ tag เดียวกับสลิปใบเบิก link ใหม่นับเป็นไฟล์ลับทุกชั้น อัปโหลดแบบรู้จักเงินทดรอง และเปิดได้เฉพาะ endpoint ของเงินทดรอง
7. ยืนยันรับเงินในระบบ ([ได้รับเงินแล้ว]/[ยังไม่ได้รับ]) แทนลายเซ็นภาพ และใช้กระดาษเป็นทางเลือก ข้อความไม่บอกว่า "ได้รับแล้ว" ก่อนผู้ขอยืนยัน การยืนยันผูกกับแถว PAYOUT (รอบ 3 F10)
8. ไม่มี permission key ใหม่สำหรับเงินทดรอง และไม่มี feature key ใหม่ (`reimbursement`/`expenses` อยู่ใน starter ทุก tier) งานนี้ไม่เพิ่ม env flag
   - **แต่ร่างใบเบิกใน LINE วันนี้ขึ้นกับ env flag `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED`** (ค่าเริ่มต้น true) ซึ่งเส้นทางเคลียร์ใน LINE ต้องใช้
   - plan Phase 5.0 จึงถอด flag นี้ออกในงานนี้ ถ้ายังไม่ถอด จะพูดไม่ได้ว่าไม่มีสวิตช์
9. Runoff: เก็บสิทธิ์ create/update_own_draft/submit/cancel_own แบบจำกัด และตรวจ entitlement เฉพาะการสร้างหรือส่งคำขอเงินทดรองใหม่และใบเบิกปกติ งานอื่นของวงจรทำได้ครบ
9b. ใบรับรองแบบเงินของร้านผูกเงินทดรองที่การจ่ายอัตโนมัติตอนออกใบ (`prisma-expense.repository.ts:3081-3112`) ทาง B ลงบัญชี Dr AP / Cr 1152-00 ไม่ลง WHT ซ้ำ
9c. `ReimbursementDraftAction` migrate constraint เพื่อรับ ADVANCE_CREATE และ `cashAdvanceId` และใช้ helper `isLineDraftActionTool` แทน prefix `reimbursement.draft.` ทั้ง API และ gateway
10. งบ Phase 0 แก้หมวดของใบเบิกก่อน:
    - ใช้หมวดชุดเดียวคือหมวดร้าน key เก่าห้าตัว map ด้วย accountHintKey
    - หมวดที่ resolve ไม่ได้ทำให้ส่งใบไม่ได้ (F2)
    - แก้ B7 ด้วย `replacedLinkedSourceIds(tx, where)` ซึ่งตัดต้นทางเฉพาะเมื่อ projection ที่แทนมันอยู่ในผลของ query เดียวกัน (รอบ 3 F3) **ยังรอรีวิวอิสระ**
    - หมวดของต้นทางที่ผูก: รับหมวดเลิกใช้ของต้นทาง → หมวดของบรรทัด → map hint ถ้าใบรับรองลงนามแล้ว ทางออกคือยกเลิกแล้วสร้างใหม่ (L3c, รอบ 3 F2) **ยังรอรีวิวอิสระ**
11. งบนับเฉพาะรายจ่ายที่ยืนยันแล้ว ยอดรวม VAT เดือนปฏิทินไทย หมวดระดับเอกสาร และไม่นับรายจ่ายต้นทางซ้ำ
    - เตือนผ่าน THRESHOLD_SCAN cooldown 0
    - แถว alert เป็นภาระที่ต้องส่ง จึงส่งใหม่ได้จนมีแจ้งเตือน
    - ส่งให้ผู้รับผิดชอบงบ ถ้าคนนั้นทำไม่ได้ส่งให้เจ้าของ
12. permission ใหม่ตัวเดียว `expense.budget.manage` ส่วนการอ่านใช้ `expense.read`
13. แท็กโครงการ เบี้ยเลี้ยง และค่ารถต่อกิโลเมตร ไม่อยู่ในรอบแรก
    - ป.59/2538 ข้อ 1(1) ยกเว้นส่วนที่เกินอัตราเมื่อมีหลักฐาน ข้อ 1(3) จำกัดเฉพาะเมื่อไม่มีหลักฐาน และทุกกรณีต้องมีการอนุมัติเดินทาง (ข้อ 2)
    - ระบบไม่มี ภ.ง.ด.1 และยังยืนยันตัวเลขอัตราไม่ได้
14. ไม่อ้าง PDPA ในเรื่องงบ ใช้หลัก least privilege (ถ้าจะอ้าง ต้องใช้ พ.ร.บ. 2562 จาก MDES)

## Bugs found (verified by reading code)

- B1 ปานกลาง: รายจ่ายจากใบเบิกไม่มีหมวด
- B2 ต่ำ–ปานกลาง: หมวดใบเบิกเว็บกับ LINE เป็นคนละชุด
- B3 ต่ำ: คำอธิบาย tool บอกว่าอนุมัติหรือจ่ายได้เฉพาะเว็บ
- B4 ต่ำ: คำบรรยายบัญชี "เงินทดรอง" บนการจ่ายคืนใบเบิก
- B5 ต่ำ: ตาราง transition ไม่ตรงกับการ void
- B6 ต่ำ: ชื่อหมวดใน LINE ส่ง id ดิบ (แก้ด้วย `listCategoryNames`)
- **B7 ปานกลาง (จากรีวิว):** LINE นับรายจ่ายต้นทางกับรายจ่ายจากใบเบิกซ้ำ
- B8 ต่ำ: token ปุ่มเปิดอนุมัติไม่มีวันหมดอายุ
- B9 ต่ำ–ปานกลาง (กฎ): ร่างใบเบิกใน LINE ปิดได้ด้วย env flag

## Review 2026-10-24 (Codex gpt-6-astra ultra: "unsafe to build") — ผลการแก้

| F | เรื่อง | แก้ที่ |
|---|---|---|
| F1 | สลิปเงินทดรองต้องได้การป้องกันระดับสลิป | cash spec §1.3, §6 (tag เดียวกัน + link ใหม่ทุกชั้น), §7 (endpoint เปิดไฟล์), plan 2.3, AC12 |
| F2 | หมวดที่ resolve ไม่ได้เลี่ยงวงเงิน | budget spec §5.2, §5.3 ข้อ 4 (ปฏิเสธตอนบันทึกและตอนส่ง), L3, AC15, plan 0.2 |
| F3 | บิลของร้านที่มี VAT/WHT ใช้เงินทดรองโดยไม่ซ้ำ | cash spec §2 ข้อ 4, §5.4, §5.7 (ทาง B), plan 3.6, AC5 |
| F4 | ใบรับรองแบบเงินของร้าน | cash spec §1.3, §5.2 (COMPANY + ทาง B, H2, R8) |
| F5 | ย้อนใบเคลียร์ที่หักกลบครบ | cash spec §5.8, §9, V1/R10, plan 3.5, AC9/AC10 |
| F6 | parser snapshot แบบ strict | cash spec §7, budget spec §6, cash plan 1.3, budget plan 1.2 |
| F7 | อัปโหลดสลิปแบบรู้จักเงินทดรอง | cash spec §7 (slip upload endpoints), plan 2.3, AC13 |
| F8 | ลงทะเบียน trigger แจ้งเตือน | cash spec §10.4, budget spec §11, cash plan 6.2, budget plan 3.2 |
| F9 | สาขาของต้นทางแจ้งเตือน | cash spec §8, cash plan 6.3, budget plan 3.2 |
| F10 | ต่อ tool ใหม่เข้า controller, category และ gateway ACTION | cash spec §7, §11, plan 5.1/5.2/5.5 |
| F11 | `expense.get_budget_status` เข้า toolMap | budget spec §11, budget plan 3.3 |
| F12 | คำเตือนงบต้องส่งใหม่ได้ | budget spec §5.1, budget plan 3.2, AC17 |
| F13 | บั๊ก LINE นับซ้ำ | budget spec §13 B7, G2, budget plan 0.5, AC16 |
| F14 | ยอดรอยืนยันต้องไม่นับซ้ำ | budget spec §5.1, budget plan 2.2 |
| F15 | ย้อนบัญชีของรายการเงินทดรอง | cash spec §5.8, plan 7.3 |
| F16 | ปิดงวดต้องนับรายการเงินทดรอง | cash spec §11, plan 7.4 |
| F17 | runoff ของการเคลียร์ | cash spec §5.9, R12, plan 2.5, AC16 |
| F18 | ถอด env flag ของร่างใบเบิกใน LINE | cash spec §2 ข้อ 7, §11, B9, plan 5.0, AC17 |
| F19 | read-memory ของ `list_open` | cash spec §7, plan 5.2 |
| F20 | B6 ใช้ `listCategoryNames` (`listCategories` กรอง ACTIVE ที่บรรทัด 3937 ไม่ใช่ 3938) | budget spec B6, budget plan 0.4 |
| F21 | ห้ามบอกว่าได้รับเงินก่อนผู้ขอยืนยัน | cash spec §5.6, P1–P3, LINE card, AC1/AC2 |
| F22 | ข้อความปฏิเสธการคืนแยกตามช่วงของใบเคลียร์ | cash spec `clearing.phase`, R2a/R2b, AC8 |
| F23 | B2t พูดถึงตอนยืนยันรายจ่าย | budget spec §10.3, AC12 |
| F24 | ป.59/2538 ไม่ได้บอกว่าส่วนเกินเป็นเงินได้ทุกกรณี | budget spec §3.1 |
| F25 | memory ต้องไม่พูดว่าไม่มี env flag | Decision 8 ข้างบน |
| F26 | token ปุ่มเปิดไม่มีวันหมดอายุ | cash spec §1.3, §7 (token ใหม่มี exp), B8, X1, AC18, plan 5.4 |
| F27 | pack ตรวจใบเบิกได้ความสามารถของเงินทดรองด้วย | cash spec §8 ตาราง pack, plan 2.5 |

## Round 2 (2026-10-24) — Codex ultra: 20/27 resolved, 7 partly, 15 new (7 HIGH)

| รายการ | เรื่อง | แก้ที่ |
|---|---|---|
| P4 / F1 (HIGH) | ใบรับรองแบบเงินของร้านจ่ายเองตอนออกใบ | cash spec §1.3, §5.2 (ผูก `cashAdvanceId` ที่การจ่ายอัตโนมัติ R13/R14), §6 (`ExpenseSubstituteReceiptEvidence.cashAdvanceId` + CHECK), plan 3.6, AC20/AC21 |
| P5 / F2 / F3 / P15 (HIGH) | ยกเลิกหรือย้อนใบเคลียร์ และถอนการยกเลิก | cash spec §5.8 ใหม่ (ปล่อย O ตอนการยกเลิกจบ, ย้อนการเคลียร์ถอนไม่ได้ R15, งวดปิดแล้ว tx ล้ม), §6 (`cashAdvanceReversalStartedAt`, `cashAdvanceOffsetReleasedAt`), §9, plan 3.5, AC22/AC24 |
| F4 (HIGH) | void การจ่ายส่วนเพิ่มต้องกลับเป็น CLEARING | cash spec §5.5, §9, plan 3.4, AC23 |
| F5 (HIGH) | constraint ของ `ReimbursementDraftAction` | cash spec §6 (SQL ใหม่), §7, plan 1.1/5.2, test PG, AC25 |
| P10 / F6 (HIGH) | prefix `reimbursement.draft.` | cash spec §1.3, §7 (`isLineDraftActionTool`), plan 5.2 (API + gateway), test |
| F7 (HIGH) | dedup ใน LINE ทำให้ยอดรอหายไป | budget spec §5.1 (`linkedSourcesWithCountedProjection`), B7, plan 0.5/2.2, AC16 |
| P12 / F11 | alert ค้างข้ามเดือน | budget spec §5.1 (40 วัน, `deliveryAbandonedAt`, ข้อความระบุเดือน), W1/F1/F2, plan 3.2, AC19 |
| P17 / F9 | runoff ต้องจบวงจรได้ | cash spec §5.9 (ตรวจเฉพาะงานใหม่), plan 2.5, AC27 |
| P23 | journey ยังพูด "หลังอนุมัติ 104%" | budget spec §4 |
| F8 | ทาง B ลง WHT ซ้ำ | cash spec §5.1, plan 7.1 |
| F10 | แจ้งเตือนไม่ปิดเมื่องานเสร็จ | cash spec §10.4 (`DOCUMENT_NOTIFICATION_STATES`), plan 6.2b, AC26 |
| F12 | ต้นทางหมวดไม่ชัดแก้ไม่ได้ | budget spec §5.3 (แก้ที่ต้นทางแล้วโหลดใหม่, L3b), plan 0.3, AC18 |
| F13 | backfill สัญญาว่าได้ทุกแถว | budget spec §5.3 (รายงานยกเว้น + `--mapping`), plan 0.4, AC3 |
| F14 | `expense.payment.void` ไม่มีอยู่จริง | cash spec §1.3, §5.8 (ใช้ `expense.payment.record`) |
| F15 | อ้างอิงการรับเฉพาะรายจ่ายที่ยืนยันแล้ว | cash spec §1.1 (`disbursement-voucher.use-case.ts:835`) |

ข้อที่ต้องให้รอบ 3 ตรวจเป็นพิเศษ:
- การปล่อย O ตอนการยกเลิกจบ (atomicity กับ reconciler)
- การผูกเงินทดรองที่การจ่ายอัตโนมัติของใบรับรอง (lock ลำดับระหว่าง funding lock กับ advance lock)
- constraint ใหม่ของ draft action กับแถวเดิม
- ยอดรอยืนยันของงบเมื่อต้นทางเป็นร่าง

## Round 3 (2026-10-24) — Codex ultra (รอบเต็มรอบสุดท้าย): 40/42 resolved, P34/P39 partly, 13 new (3 HIGH)

| รายการ | เรื่อง | แก้ที่ | สถานะ |
|---|---|---|---|
| F1 (HIGH) | gateway ปฏิเสธ ADVANCE_* (`semantic-turn-v2.ts:396`) | cash spec §7, cash plan 5.2 | **BLOCKER รอรีวิว** |
| F2 (HIGH) / P39 | แก้หมวดที่ต้นทางซึ่งใบรับรองลงนามแล้วไม่ได้ (`prisma-expense.repository.ts:1979`) | budget spec §5.3 ข้อ 1 + L3b/L3c, budget plan 0.2/0.3 | **BLOCKER รอรีวิว** |
| F3 (HIGH) / P34 | dedup ต้องสน filter ของ query (`:1353`) และเลิกตัดทั้งหมด | budget spec §5.1/B7, budget plan 0.5/2.2 และข้อตัดสินใจ 9 | **BLOCKER รอรีวิว** |
| F4 | offset ค้างเมื่อใบเคลียร์กลับเป็นร่าง | cash spec §5.5, cash plan 3.1 | แก้แล้ว |
| F5 | ยกเลิกทาง B ที่ลงบัญชีแล้ว (`expense-void-blocker.ts:150`) | cash spec §5.7, cash plan 3.6 | แก้แล้ว |
| F6 | ใบที่ส่งก่อน deploy ไม่มีหมวด | budget spec §5.3, budget plan 0.2/0.4 | แก้แล้ว |
| F7 | ผู้รับ alert ต้องตรวจสิทธิ์ซ้ำ | budget spec §8, budget plan 3.2 | แก้แล้ว |
| F8 | ตัดผู้ทำแยกตามเหตุการณ์ | cash spec §10.4, cash plan 6.1 | แก้แล้ว |
| F9 | งานตรวจสลิปคืนตอน PAID | cash spec §10.4, cash plan 6.2b | แก้แล้ว |
| F10 | การยืนยันรับเงินผูกกับ PAYOUT | cash spec §5.6/§6/P2/P3, cash plan 1.1/2.1 | แก้แล้ว |
| F11 | `notificationPeriodKey` ของการเตือนซ้ำ | cash spec §10.4, budget spec §5.1, plans 6.4/3.2 | แก้แล้ว |
| F12 | ข้อความ R8 | cash spec §10.2 | แก้แล้ว |
| F13 | ไฟล์ส่งออกชุดเต็มมี 56 คอลัมน์ | budget spec §3.1 (`expenses.ts:1731`) | แก้แล้ว |

ข้อที่ยังไม่ปิด และต้องพูดตรง ๆ:
- การกู้หมวดของต้นทาง (F2) และการไม่นับซ้ำ (F3) ยังไม่ผ่านรีวิวอิสระ อย่าถือว่าเสร็จ
- ทั้งสองข้อ block budget Phase 0 ซึ่ง cash Phase 3 พึ่ง

## Focused blocker check (2026-10-24) — Codex ultra

| รายการ | ผล | แก้ที่ |
|---|---|---|
| F1 gateway `ADVANCE_*` | **ปิดแล้ว** | cash spec §7, plan 5.2 |
| F2 การกู้หมวดของต้นทาง | ยังเปิด: การตรวจ draft ที่รับเฉพาะ ACTIVE ปฏิเสธหมวดเลิกใช้ของต้นทาง และใบแก้ไขที่ ISSUED ยกเลิกไม่ได้ (`prisma-expense.repository.ts:2098`) | budget spec §5.3 (ข้อยกเว้นของต้นทางที่เชื่อได้ และ L3c ผ่านเอกสารแก้ไขใบรับรอง `executeCorrection`), budget plan 0.2/0.3 |
| F3 การไม่นับซ้ำในงบ | ยังเปิด: query ใช้แล้วกับรอยืนยันที่แยกกันนับ projection และต้นทางซ้ำ | budget spec §5.1 (ตัดกับประชากรรวมก่อนแยกถัง), budget plan 2.2 และข้อตัดสินใจ 9 |
| F4 (ใหม่ HIGH) หมวดของ projection ที่ผูกต้นทาง | เปิด: classification ถูกกระจายตรง ๆ (`prisma-reimbursement.repository.ts:2349`) ต้นทางแบบมีแค่ hint จึงไม่เข้างบใดเลย | budget spec §5.3 F4, budget plan 0.2/2.2, AC24 |

- ฝั่งเงินทดรอง: READY ไม่มี HIGH เปิด แต่ Phase 3 รอ budget Phase 0
- ฝั่งงบ: DRAFT blocked on F2, F3 และ F4 ต้องตรวจซ้ำแบบเจาะจง
- ข้อที่ยังต้องพิสูจน์ใน implementation คือการแก้หมวดระหว่างเอกสารแก้ไขยัง PREPARED ผ่าน lock ได้ (test gate ของ F2)

## Budget focused re-check (2026-10-24)

- F3 **ปิดแล้ว** (ตัดกับประชากรรวมก่อนแยกถัง)
- F4 **ปิดแล้ว** (projection พาหมวดที่ resolve แล้วไปด้วย)
- F2 **ยังเปิด (blocker ตัวเดียว)**: เอกสารแก้ไขแบบเดิมคัดลอก snapshot ที่ลงนาม (`prisma-expense.repository.ts:2837`, `substitute-receipt.use-case.ts:313-316`) จึงลงนามหมวดเดิม
  - ออกแบบใหม่เป็นเอกสารแก้ไขแบบแก้หมวด (`correctionKind: CLASSIFICATION`) ที่ snapshot มีหมวดใหม่และถูกลงนาม แก้หมวดของต้นทางใน tx เดียวกัน และ `readReimbursementSource` ตรวจว่าหมวดใน snapshot ตรงกับหมวดของต้นทาง
  - test gate ของ plan 0.3: หมวดใน snapshot ที่ลงนาม = หมวดของบรรทัดใบเบิก
  - ต้องตรวจซ้ำแบบเจาะจง

## Budget F2 last focused check (2026-10-24)

- ผล: ยังเปิด เพราะการแก้หมวดเกิดที่รายจ่ายต้นทางตั้งแต่เตรียมเอกสารแก้ไข และการยกเลิก (`prisma-expense.repository.ts:2105`, `:2715`) ไม่คืนค่า
- ออกแบบใหม่ (ยังไม่มีใครรีวิว):
  - พักหมวดใหม่ไว้ที่เอกสารแก้ไข (`stagedClassificationJson`)
  - เขียนลงต้นทางเฉพาะใน tx ที่ออกใบ แบบ CAS
  - ยกเลิกแล้วทิ้งค่าที่พัก
  - ตอนเตรียมปฏิเสธรายจ่ายที่ยืนยันแล้ว ลงบัญชีแล้ว หรือผูกใบเบิกที่ส่งแล้ว
- gate 0.3 เพิ่มกรณีเตรียม → ยกเลิก, เตรียม → void และ CAS ล้ม
- **บันทึก: F2 = designed, needs review before budget Phase 0.3** ส่วน budget Phase 0.1–0.2 เริ่มได้ และ cash Phase 3 รอ budget Phase 0.3

## Open questions (ถามเจ้าของ พร้อมคำแนะนำ)

- เงินทดรอง Q1: คนที่มีเงินทดรองค้าง ขอใบใหม่ได้ไหม → แนะนำให้ได้ และผู้อนุมัติเห็นยอดค้าง
- เงินทดรอง Q2: วันเคลียร์ค่าเริ่มต้น → แนะนำ 7 วัน
- เงินทดรอง Q3: ต้องอนุมัติทุกใบไหม → แนะนำทุกใบ
- งบ Q1: เกินงบให้ห้ามไหม → แนะนำไม่ห้าม ให้เตือน
- งบ Q2: เกินวงเงินต่อใบ → แนะนำส่งได้แต่ต้องอนุมัติ
- งบ Q3: ผู้รับแจ้งเตือน → แนะนำผู้รับผิดชอบงบ และเจ้าของเมื่อคนนั้นทำไม่ได้
- งบ Q4: แท็กโครงการ → แนะนำยังไม่ทำ

## Artifacts

- `docs/specs/cash-advance-and-clearing-spec.md`
- `docs/plans/cash-advance-and-clearing-plan.md`
- `docs/specs/expense-budget-and-limits-spec.md`
- `docs/plans/expense-budget-and-limits-plan.md`
- รีวิว: `codex-review/review-advances.md`
- แหล่งภายนอกที่เปิดอ่านแล้ว:
  - rd.go.th: 3588, 26858, 37195, 31914, 46546, 3409, 25045, 5939
  - FlowAccount เงินทดรองจ่าย และ PEAK เงินทดรองจ่าย
- ยังไม่ได้เปิดซ้ำ: rd.go.th 23163 และ 28308, PEAK กลุ่มจัดประเภท, ประกาศ DBD 2544 และอัตราราชการของ cgd.go.th

## Verification

- เป็นงานเอกสารล้วน ไม่ได้รัน test, build หรือ server
- เลขบรรทัดใหม่ทุกจุดที่อ้างในรอบแก้ ตรวจด้วย grep/sed แล้ว (download guard 88-100, parser 83-126, `listCategories` 3937, `listCategoryNames` 3923-3929 และอื่น ๆ)
- ไฟล์ API spec ที่อ้างใน test plan ตรวจแล้วว่าอยู่ใน `apps/api/package.json` (`erp-tool.client.spec.ts` อยู่ใน test script ของ gateway) ไฟล์ที่รันเฉพาะในชุด whole-chain ระบุเป็นส่วนเสริมเท่านั้น

## Next

1. รีวิวซ้ำ (เน้น §5.7–5.9 และ §9 ของ cash spec, budget §5.1–5.3)
2. เจ้าของตอบ Q หรือรับคำแนะนำ
3. รีวิวสั้นเฉพาะ F1–F3 ของรอบ 3 ต้องผ่านก่อน แล้วจึง implement ตามลำดับ:
   - budget plan Phase 0 (รวม 0.5 B7)
   - cash plan Phase 5.0 (ถอด flag)
   - cash plan Phase 1 → 3
   - เว็บ และ LINE
   - budget plan Phase 1 → 3
4. ทุกขั้น UI ต้องมีภาพจาก browser จริงที่ 390, 1,280 และ ~1,556 px
5. ให้นักบัญชีทบทวนตาราง Dr/Cr ก่อน Phase 7
