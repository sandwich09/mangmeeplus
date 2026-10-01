# Spec: สวิตช์ทางเข้าบันทึกค่าใช้จ่ายด้วยมือบนเว็บ

วันที่: 2026-10-01 · Version: 3.0 — ค่าตั้งหน้าจอรายร้าน (แก้ตามรีวิวอิสระ)

Status: **PROPOSAL — รอเจ้าของยืนยันข้อเสนอ D1–D8 ใน §1; ยังไม่อนุญาตให้ implement และยังไม่เปลี่ยนค่าใดในระบบจริง**

Owner: thawatchai · Scope: ค่าตั้งรายร้าน "แสดงเมนูบันทึกด้วยมือบนเว็บ" ที่ผู้ดูแลระบบตั้งได้ใต้ฟีเจอร์ "บันทึกด้วยมือ"; สัญญา session หนึ่งค่า และทางเข้าบนเว็บเท่านั้น

ฐานโค้ดที่ใช้ตรวจ v3.0: `origin/develop` `ae13970b0` · ข้อค้นพบของ v2.0 ถูกตรวจบน `4a5817b42` ซึ่งไม่ใช่บรรพบุรุษของ develop รายการที่เปลี่ยนอยู่ในภาคผนวก A

เอกสารประกอบ:

- [Implementation plan](../plans/manual-expense-web-entry-flag-plan-th.md)
- [รีวิวอิสระ 2026-10-01 (ข้อค้นพบ RM-01 ถึง RM-25)](../research/manual-expense-web-entry-flag-review-2026-10-01-th.md)
- [บั๊กในระบบปัจจุบันที่แก้แยกจากงานนี้](../research/manual-expense-current-code-bugs-2026-10-01-th.md)
- [Impact audit (ฐานเก่า มีหมายเหตุกำกับ)](../research/manual-expense-web-entry-flag-audit-2026-10-01-th.md)
- [Local E2E simulation (ทดสอบ key เดิมเท่านั้น มีหมายเหตุกำกับ)](../qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md)
- [Task memory](../agent-memory/manual-expense-web-entry-flag.md)
- [Feature entitlement decoupling](feature-entitlement-decoupling-spec.md)
- [Submenu entitlement plan เดิม](../plans/feature-entitlement-submenu-plan.md)
- [Expense receipt upload](expense-receipt-upload-spec.md)
- [LINE expense draft conversation](line-ai-expense-draft-conversation-spec.md)
- [LINE edit capability consistency](line-ai-expense-edit-capability-consistency-spec-th.md)
- [Substitute receipt edit sync](substitute-receipt-expense-edit-sync-spec.md)
- [Marketplace capture contract](marketplace-buyer-expense-capture-contract-appendix-th.md)

## 1. Product decision และข้อเสนอที่รอยืนยัน

### 1.1 สิ่งที่เจ้าของตัดสินแล้ว (2026-10-01)

Owner ยืนยัน “ปิดแค่ทางเข้าการ manual บน web”, “ยังไม่แก้นะ ทำ spec มาก่อน” และ **“เอา flag ย่อย ภายใต้ feature บันทึกด้วยมือ ซ่อน ทางเข้า menu นี้ไป เปิดปิดได้ เบื้องหลังทำงานเหมือนเดิม”**

จากคำตัดสินนี้ สิ่งที่ตายตัวแล้วคือ

1. ผู้ดูแลระบบเห็นสวิตช์ย่อยใต้ฟีเจอร์ “บันทึกด้วยมือ” ในหน้าแพ็กเกจและฟีเจอร์ของร้าน เปิดและปิดได้
2. ปิดแล้วเมนู ปุ่ม และลิงก์ที่พาไปหน้าบันทึกด้วยมือบนเว็บหายไป ไม่ครอบการกรอกด้วยมือภายใน OCR และ wizard ใบรับรองแทนใบเสร็จ
3. เบื้องหลังเหมือนเดิม: ไม่เปลี่ยน guard ของ POST/PATCH/DELETE, สิทธิ์ของบทบาท, LINE, OCR, wizard, การเบิกจ่าย หรือพฤติกรรมด้านเงิน
4. `expenses.manual` คง `permissionKeys: ['expense.create', 'expense.update']` และความหมายเดิมทุกประการ ร้านที่ปิด `expenses.manual` อยู่ยังถูกตัดสิทธิ์ตามเดิม ไม่มีการคืนสิทธิ์อัตโนมัติ

### 1.2 ข้อเสนอ รอเจ้าของยืนยัน

เจ้าของยังไม่ได้ตอบคำถามแปดข้อจาก[รีวิวอิสระ](../research/manual-expense-web-entry-flag-review-2026-10-01-th.md) เอกสารฉบับนี้เขียนตามคำตอบที่แนะนำ ทุกจุดที่ขึ้นกับข้อเสนอมีป้าย **(ข้อเสนอ Dn รอเจ้าของยืนยัน)** ถ้าเจ้าของเลือกทางเลือก ให้แก้เฉพาะหัวข้อในคอลัมน์สุดท้าย

| รหัส | คำถาม | ข้อเสนอ รอเจ้าของยืนยัน | ทางเลือกและต้นทุน | หัวข้อที่ต้องแก้ถ้าเลือกทางเลือก |
| --- | --- | --- | --- | --- |
| D1 | สวิตช์นี้เป็นส่วนหนึ่งของแพ็กเกจที่ขาย หรือเป็นการตั้งค่าหน้าจอของร้าน | เป็นการตั้งค่าหน้าจอของร้าน เก็บแยกจากสิทธิ์แพ็กเกจ แต่ยังแสดงให้ผู้ดูแลเห็นใต้ “บันทึกด้วยมือ” ในหน้าเดิม | เป็นสิทธิ์ในชุดแพ็กเกจ: ต้องแก้ระบบชำระเงิน การเปิดร้านใหม่ หน้าผู้ดูแล และ LINE เพิ่มตามภาคผนวก B มิฉะนั้นร้านเดิมซื้อแพ็กเกจไม่ได้และ LINE ถูกรบกวน | §5, §10, §13–§15, ภาคผนวก B |
| D2 | ร้านเดิม ร้านใหม่ และร้านที่ซื้อหรืออัปเกรดแพ็กเกจ ควรเห็นเมนูนี้เป็นค่าเริ่มต้นไหม | เห็นเมนูทุกร้านเป็นค่าเริ่มต้น การซื้อ อัปเกรด ดีล และชุดสำเร็จรูปไม่เปลี่ยนค่านี้เลย | ให้แพ็กเกจหรือชุดสำเร็จรูปเป็นผู้กำหนด: ต้องย้ายไปอยู่ในชุดสิทธิ์ตามทางเลือกของ D1 | §5.1, §10 |
| D3 | ปิดสวิตช์นี้เพื่ออะไร | เพื่อซ่อนเมนูเท่านั้น ไม่ใช่การห้ามบันทึกด้วยมือ และไม่ใช่การควบคุมสิทธิ์ | ต้องการห้ามพนักงานพิมพ์รายจ่ายเอง: เป็นงานอีกชิ้นที่ต้องปิดที่ระบบหลังบ้าน และต้องตัดสินเรื่องใบรับรองแทนใบเสร็จ LINE และการแก้ร่างด้วย | §2, §4, §8, §13 |
| D4 | คู่มือบนเว็บและคำตอบของผู้ช่วยใน LINE ที่พูดถึงบันทึกด้วยมือ ต้องปรับเมื่อปิดไหม | คู่มือบนเว็บซ่อนปุ่มเปิดหน้า และขึ้นหมายเหตุที่หัวข้อ “บันทึกด้วยมือ” ว่าร้านซ่อนเมนูนี้ไว้ ส่วนคำตอบใน LINE ไม่แก้รอบนี้ | (ก) ลบหัวข้อทั้งหัวข้อ: ต้องแก้เลขหัวข้อและคำว่า “เมนูย่อยทั้ง 8 รายการ” และคู่มือเว็บจะไม่ตรงกับฉบับเอกสาร (ข) แก้คำตอบ LINE ทันที: ต้องทบทวนชุดคำตอบใหม่และส่งค่าของร้านไปถึงผู้ช่วย | §9, §13 |
| D5 | ถ้าระบบอ่านค่าสวิตช์ไม่ได้ชั่วคราว ให้แสดงหรือซ่อนเมนู | แสดงเมนูไว้ก่อน | ซ่อนไว้ก่อน: ถ้าระบบตอบไม่ครบหรือถอยรุ่น ทุกร้านจะเข้าหน้านี้ไม่ได้ทั้งที่ไม่มีใครสั่งปิด | §6 |
| D6 | พนักงานที่กรอกค้างบนมือถือ แล้วหน้าเว็บโหลดใหม่เองหลังปิดสวิตช์ จะกลับเข้าไม่ได้ ยอมรับได้ไหม | ยอมรับ โดยเตือนผู้ดูแลก่อนปิด | เก็บร่างไว้ในเครื่องหรือให้กลับเข้าได้ชั่วคราว: ต้องสร้างที่เก็บร่างใหม่ ซึ่งอยู่นอกขอบเขต | §7 |
| D7 | ร้านที่ปิดอัปโหลดใบเสร็จอยู่ จะยอมให้ซ่อนเมนูนี้ด้วยไหม | ยอม แต่เตือนผู้ดูแลก่อนบันทึก | ห้ามปิดทั้งคู่: ต้องเพิ่มกติกาผูกสองค่า และตัดสินว่าถ้าปิดอัปโหลดทีหลังจะเกิดอะไรขึ้น | §8 |
| D8 | บั๊กปุ่มลบรายจ่ายฉบับร่างของบทบาทการเงินที่สร้างจากเทมเพลต จะแก้แยกเลยหรือรอ | แก้แยกเป็นงานเล็ก ไม่รองานนี้ | รอ: บทบาทดังกล่าวยังเห็นปุ่มลบที่กดแล้วไม่สำเร็จ | §11 |

**v3.0 supersedes v2.0** ซึ่งเสนอ key `expenses.manual.web_entry` ใน `FEATURE_CATALOG` และ **v1** ซึ่งเสนอใช้ `expenses.manual` เดิม งานปัจจุบันยังเป็นเอกสาร ไม่มี authorization ให้ implement หรือ deploy

## 2. Goal, ผู้ใช้ และ acceptance outcome

จุดประสงค์ **(ข้อเสนอ D3 รอเจ้าของยืนยัน)**: ให้ผู้ดูแลระบบซ่อนเมนูบันทึกด้วยมือของร้านได้ เพื่อให้หน้าจอของพนักงานพาไปที่การอัปโหลดใบเสร็จเป็นหลัก สวิตช์นี้ **ไม่ใช่การห้าม** และ **ไม่ใช่ขอบเขตความปลอดภัย** ผู้มี `expense.create` ยังสร้างรายจ่ายได้ผ่าน API, wizard ใบรับรองแทนใบเสร็จ และ LINE ตามสิทธิ์เดิม

| ผู้ใช้ | สิ่งที่ต้องเกิด |
| --- | --- |
| System admin | เห็นสวิตช์ใต้ “บันทึกด้วยมือ” พร้อมคำอธิบายตรงกับสิ่งที่ทำจริง เปิดปิดได้กับทุกร้าน รวมร้านเดิม มี audit |
| พนักงานผู้สร้าง | ปิดแล้วไม่เห็นทางเข้าหน้าบันทึกด้วยมือ ยังอัปโหลด แก้ร่างของตน และส่งตรวจได้ตามสิทธิ์ |
| Reviewer / finance | งานตรวจ ยืนยัน จ่าย ลบ และหลักฐานเดิมไม่ถูกสวิตช์นี้แตะ |
| ผู้ใช้ LINE | บทสนทนา งานที่ค้าง และสิทธิ์ capture/แก้ไข ไม่เปลี่ยนเมื่อมีการสลับสวิตช์ |
| ลูกค้าที่กำลังชำระเงิน | การสลับสวิตช์ไม่กระทบการซื้อหรือการเปิดแพ็กเกจที่จ่ายแล้ว |
| Read-only / ผู้ข้ามบริษัทหรือสาขา | การเปิดสวิตช์ไม่เพิ่มสิทธิ์ใด |

Journey หลัก: admin เปิดหน้าร้าน → แพ็กเกจและฟีเจอร์ → ค่าใช้จ่ายและใบเสร็จ → แถว “บันทึกด้วยมือ” → ปิดสวิตช์ย่อย “แสดงเมนูบันทึกด้วยมือบนเว็บ” → ยืนยัน → พนักงานที่เปิดหน้าใหม่ไม่เห็นทางเข้า แท็บที่เปิดค้างปรับภายในรอบตรวจปกติ → อัปโหลดและตรวจรายการทำต่อได้ → เปิดกลับ → ทางเข้ากลับมาเฉพาะผู้มีสิทธิ์

## 3. Current-state findings (ตรวจซ้ำที่ `ae13970b0`)

คอลัมน์ “ขอบเขต” บอกว่าแต่ละข้ออยู่ในงานนี้หรือไม่ ผู้ลงมือทำต้องตรวจทุกข้อซ้ำที่ commit ที่จะเริ่มงานตาม plan P0

| ID | ข้อเท็จจริง ณ `ae13970b0` | ขอบเขต | Target |
| --- | --- | --- | --- |
| F01 | ปิด `expenses.manual` ตัด `expense.create` และ `expense.update` ของทุกบทบาท (E2E เดิมยืนยัน 9 จาก 10 บทบาทที่ถือสิทธิ์นี้ ไม่ได้ทดสอบ HR) | งานนี้ไม่แตะ | ไม่ใช้ key เดิมเป็นตัวซ่อนเมนู และไม่แก้ mapping |
| F02 | DELETE controller ต้องมี `expense.update` แต่ UI และ use case ยอมรับ `expense.delete` กระทบบทบาทที่สร้างจากเทมเพลตการเงินสี่แบบ บทบาทในระบบไม่ได้รับผล | แยก | ดู §11 และ[เอกสารบั๊ก B1](../research/manual-expense-current-code-bugs-2026-10-01-th.md) |
| F03 | ปิดแล้ว: แก้ใน `6fddca795` (2026-09-29) `lineDraftIdempotencyKey()` คืน `line-draft-<id>` ที่ผ่าน `PAYMENT_IDEMPOTENCY_KEY_PATTERN` และอยู่ใน main และ develop | ปิดแล้ว | ไม่มีงาน ห้ามเปลี่ยนสูตร key อีก (§12) |
| F04 | `/auth/me` และ `WebSession` ไม่มีข้อมูลใดบอกว่าร้านซ่อนเมนูนี้ | งานนี้ | เพิ่ม boolean หนึ่งค่า ไม่ส่งรายการ feature ทั้งชุด (§6) |
| F05 | `accessContextFingerprint` มี roles, roleNames, permissions และ branchIds การเปลี่ยนค่าที่ไม่กระทบสิทธิ์จึงไม่สั่ง refresh | งานนี้ | เพิ่ม boolean เดียวกันใน fingerprint (§6.3) |
| F06 | ทางเข้าหน้า manual กระจายหลายจุด และมีข้อความในคู่มือกับ LINE ที่บอกให้ไปหน้านี้ | งานนี้ | รายการครบใน §9 |
| F07 | `applyPreset` ไม่อ่าน state เดิม | ไม่เกี่ยวกับงานนี้แล้ว | ค่าตั้งใหม่ไม่อยู่ในชุดสิทธิ์ ชุดสำเร็จรูปจึงแตะไม่ได้ (§10) พฤติกรรมของ `expenses.manual` คงเดิม |
| F08 | เมื่อ `expense.create` หาย หน้า hub แทนฟอร์มด้วยข้อความไม่มีสิทธิ์ ฟอร์มที่กรอกค้างจึงหาย (พฤติกรรมของ key เดิม) | งานนี้ | ค่าตั้งใหม่ต้องไม่ทำให้ฟอร์มที่รับเข้าแล้วหาย (§7) |
| F09 | unit test ยืนยันรูป key ของ LINE แล้ว ยังไม่มี integration แบบ compose จริง | แยก | เพิ่มได้เป็นงานแยกโดยยืนยัน key ปัจจุบัน |
| F10 | key ใน `FEATURE_CATALOG` ถูกปฏิบัติเป็นสิทธิ์ทุกที่: ระบบชำระเงินบังคับรูปชุดแถว, command สิทธิ์ล้างสถานะ LINE และ bump `setVersion`, onboarding และ billing เขียนค่าจากรายการแพ็กเกจ | เหตุผลของ D1 | ไม่เพิ่ม key เข้า catalog (§5) รายละเอียดในภาคผนวก B |
| F11 | `expenses-guide.content.ts` ถูกตรึง hash โดยชุดคำตอบ LINE (`approved-product-help.ts`) | งานนี้ | ไม่แก้ไฟล์นี้ ใช้การแปลงผลลัพธ์แทน (§9) |
| F12 | ไฟล์ session ฝั่งเว็บและ guard ถูกตรึงโดย `validate-production-maintenance-release.sh` | งานนี้ | ไม่แก้ไฟล์ที่ถูกตรึง (plan §2) |
| F13 | Next 16.3.4: หน้า dynamic ถูกดึงใหม่เมื่อไปข้างหน้า แต่ back/forward ใช้หน้าที่เบราว์เซอร์จำไว้ และ `cacheComponents` ไม่ได้เปิดใช้ | งานนี้ | กติกา admission ใน §7 |

ห้ามใช้ baseline tests ที่ผ่านเป็นหลักฐานว่า target behavior implement แล้ว และห้ามใช้ผล E2E เดิมรับรอง v3 เพราะการทดลองนั้นปิด `expenses.manual` บนฐานโค้ดเก่า

## 4. Truth table ของค่าตั้งใหม่

ตารางนี้ตรึง `expenses=true` และ `expenses.manual=true` ไว้ การสลับค่าตั้งต้องไม่แตะสองค่านี้

ทุกช่อง “ตามเดิม” หมายถึงยังต้องผ่าน company active, membership, role permission, tenant/branch, source state และกติกาเฉพาะ flow

| เส้นทาง/การกระทำ | แสดงเมนู (ค่าเริ่มต้น) | ซ่อนเมนู |
| --- | --- | --- |
| Sidebar/ปุ่ม/ลิงก์เข้า `/expenses/manual` | แสดงเมื่อมี `expense.create` | ซ่อน |
| เข้า URL หน้า manual ใหม่ / reload / เปิดแท็บใหม่ | เปิดฟอร์มเมื่อมี `expense.create` | แสดงสถานะ “ร้านซ่อนหน้านี้ไว้” ไม่เปิดฟอร์ม server ตอบ 200 ตามปกติ |
| ฟอร์ม manual ที่เปิดอยู่ก่อนซ่อน | ทำต่อได้ | ทำต่อได้ ห้ามล้าง input, ไฟล์ หรือ idempotency key |
| POST `/expenses` โดยผู้มี `expense.create` | ตามเดิม | ตามเดิม |
| สร้างรายการใหม่ในใบรับรองแทนใบเสร็จ | ตามเดิม | ตามเดิม |
| แก้ draft เดิมทุก capture source / ส่งตรวจ / เริ่มตรวจใหม่ | ตามเดิม | ตามเดิม |
| Upload, OCR ไม่พร้อมหรือเกิน quota, กรอกผล OCR เอง | ตามเดิม | ตามเดิม |
| LINE text/media/continuation/edit preview/apply | ตามเดิม | ตามเดิม |
| Capture group/review/allocation/handoff | ตามเดิม | ตามเดิม |
| ใบเบิกจ่ายและ expense projections | ตามเดิม | ตามเดิม |
| Confirm/payment/void/ledger/tax/export/report | ตามเดิม | ตามเดิม |
| ซื้อ อัปเกรด ดีล ชุดสำเร็จรูป เปิดร้านใหม่ | ไม่อ่านและไม่เขียนค่านี้ | ไม่อ่านและไม่เขียนค่านี้ |

เมื่อ `expenses` หรือ `expenses.manual` ปิด ผู้ใช้ไม่มี `expense.create` อยู่แล้ว ทางเข้าจึงหายตามกติกาเดิมโดยไม่ขึ้นกับค่าตั้งใหม่ และค่าที่เก็บไว้ไม่ถูกแก้ เมื่อเปิดฟีเจอร์กลับ ค่าเดิมมีผลต่อทันที

## 5. Data model และ permission contract

### 5.1 ที่เก็บ **(ข้อเสนอ D1 และ D2 รอเจ้าของยืนยัน)**

สวิตช์นี้ **ไม่ใช่ entitlement key** ไม่เพิ่มอะไรใน `FEATURE_CATALOG`, `ALL_FEATURE_ENTITLEMENT_KEYS`, `MENU_ENTITLEMENT_BINDINGS`, `STARTER_FEATURE_KEYS`, `TIER_FEATURE_PRESETS` หรือ `SALES_DEAL_ALLOWED_FEATURE_KEYS` และไม่เขียนแถวใน `CompanyFeatureEntitlement`

- เก็บเป็นค่าตั้งรายร้านแบบเดียวกับ `CompanyAiConfiguration.ocrEnabled` (`apps/api/prisma/schema.prisma:4075`) คือ boolean ค่าเริ่มต้นเปิด มี version ของตัวเองสำหรับ CAS และแถวถูกสร้างเมื่อผู้ดูแลบันทึกครั้งแรกเท่านั้น
- รูปที่เสนอ: model ใหม่หนึ่งตัว (ชื่อเสนอ `CompanyWebEntrySetting`) มี `companyId` (unique, ลบตามบริษัท), `manualExpenseEntryEnabled Boolean @default(true)`, `version Int @default(0)`, `updatedBySystemAdminUserId`, `createdAt`, `updatedAt` ชื่อ model และ field ปรับได้ตอน review schema แต่กติกาต้องคงเดิม
- **ไม่มีแถว = แสดงเมนู** ร้านเดิมทุกร้านจึงเห็นเมนูเหมือนวันนี้โดยไม่ต้อง backfill และร้านใหม่ไม่ต้องมีขั้นตอนใดใน onboarding
- ต้องมี migration แบบ additive หนึ่งรายการ (`CREATE TABLE` อย่างเดียว ไม่แตะตารางเดิม ไม่มีการย้ายข้อมูล) จึงต้องปล่อยผ่านเส้นทาง release ปกติที่รองรับ migration ตาม [deployment protocol](../runbooks/uat-production-v2-deployment.md)
- ไม่เพิ่ม environment switch, SKU, permission หรือ pack

### 5.2 Authority invariance

ห้ามแก้ `expenses.manual.permissionKeys`, `pack.expense.self`, HTTP expense guards, `SetPartnerFeaturesUseCase`, `evaluateEntitledFeatureKeys`, `filterPermissionsByEntitlement` หรือ source-state conditions ในงานนี้ ค่าตั้งใหม่ถูกอ่านเพียงสามจุด คือ `GET /v1/auth/me`, `GET` รายละเอียดร้านของผู้ดูแล และ command ใน §5.3 ไม่มี guard, use case, repository, LINE tool หรือ billing ใดอ่านค่านี้

เมื่อ roles, scopes และสิทธิ์แพ็กเกจเท่าเดิม ต้องได้

```text
permissions(แสดง) == permissions(ซ่อน) == permissions(แสดงอีกครั้ง)
entitledFeatureKeys(แสดง) == entitledFeatureKeys(ซ่อน)
CompanyEntitlementSet.setVersion ไม่เปลี่ยนเมื่อสลับค่าตั้งนี้
```

ต้องเทียบ permission ทั้งชุดของทุกบทบาทใน `ROLE_GRANTS` และทุกเทมเพลตใน `ROLE_TEMPLATES` ไม่ใช่ดูแค่ `expense.create`

### 5.3 Command ของผู้ดูแล

ใช้รูปแบบเดียวกับ `SetPartnerOcrConfigUseCase` (`apps/api/src/modules/system-partner-management/application/use-cases/set-partner-ocr-config.use-case.ts`)

- endpoint ใหม่ใต้ `/v1/system/partners/:partnerCompanyId/` (ชื่อเสนอ `manual-expense-web-entry`) guard ด้วย `system.partner_feature.manage` ซึ่งเป็นสิทธิ์เดียวกับการแก้ฟีเจอร์ของร้าน ไม่เพิ่ม permission
- body เป็นค่าที่ต้องการแบบสัมบูรณ์: `enabled` และ `expectedVersion` ไม่บังคับกรอกเหตุผล (ต่างจาก OCR config) เพราะไม่ใช่การปรับโควตาหรือสิทธิ์ และหน้าจอมีขั้นยืนยันก่อนซ่อนอยู่แล้ว
- ค่าที่ขอเท่ากับค่าปัจจุบัน: คืนค่าปัจจุบัน ไม่เขียน ไม่ audit ไม่เพิ่ม version การกดซ้ำหรือ retry หลัง response หายจึงปลอดภัย
- ค่าต่างและ `expectedVersion` ไม่ตรง: 409 ให้โหลดใหม่ก่อนบันทึก
- ร้านสถานะ `DISABLED` หรือ `ARCHIVED`: ปฏิเสธด้วยกติกา `partnerMetadataLockError` เดิม
- ทำใน transaction เดียวกับ audit ไม่เรียก `invalidateLineConversationState` ไม่สร้าง `EntitlementTransition`, `RunoffSnapshot` หรือ `EntitlementCommand` และไม่แตะ `CompanyEntitlementSet`
- `GET` รายละเอียดร้านคืนค่าปัจจุบันและ version เสมอ รวมร้านที่ยังไม่มีแถว (ค่า = แสดง, version = 0)

### 5.4 Audit

เขียน `AuditLog` หนึ่งแถวต่อการเปลี่ยนค่าจริง เก็บ company, ผู้ดูแล, requestId, ค่าเดิม, ค่าใหม่, version เดิมและใหม่ ใช้ action ใหม่ชื่อเสนอ `system.partner_manual_expense_web_entry.update` การอ่านค่าเพื่อแสดงเมนูไม่สร้าง audit

## 6. Session contract: API → web

### 6.1 ค่าเดียว **(ข้อเสนอ D5 รอเจ้าของยืนยัน)**

`GET /v1/auth/me` เพิ่ม field เดียวแบบ additive ที่ server คำนวณ: `manualExpenseWebEntry: boolean` (true เมื่อร้านไม่มีแถวหรือแถวระบุว่าแสดง) อ่านใน `auth.controller.ts` พร้อมข้อมูลอื่นของ response เดิม ไม่ผ่าน `ResolvedAccess`, `RequestContext` หรือ resolver เพื่อไม่ให้ค่านี้ไปถึง LINE หรือ fingerprint ของ LINE

```json
{
  "companyId": "company-A",
  "permissions": ["expense.create", "expense.update", "expense.receipt.upload"],
  "manualExpenseWebEntry": false
}
```

เว็บไม่รับรายการ feature ทั้งชุด เพราะเมื่อ `expenses` หรือ `expenses.manual` ปิด `expense.create` ถูกตัดอยู่แล้ว ข้อมูลที่เว็บต้องรู้เพิ่มจึงมีเพียงค่านี้

| ค่าที่เว็บได้รับ | ความหมาย |
| --- | --- |
| `true` | แสดงทางเข้าตามสิทธิ์ |
| `false` | ร้านซ่อนเมนู |
| field หายหรืออ่านไม่ได้ | ถือว่าแสดง เพราะค่าเริ่มต้นคือแสดง และ API เป็นผู้ตัดสินสิทธิ์จริงอยู่แล้ว |

ห้ามให้ browser ส่งค่านี้กลับมาเพื่อเปลี่ยนสิทธิ์ และไม่เก็บใน localStorage หรือ JWT

### 6.2 Predicate เดียวสำหรับทางเข้า

เพิ่ม helper เล็กใน web expense feature (ชื่อเสนอ `manual-expense-entry.logic.ts`) ใช้ร่วมกันทุกจุดใน §9

```text
canOpenManualWeb = session เป็นของบริษัทที่เปิดอยู่
  AND permissions มี expense.create
  AND manualExpenseWebEntry !== false
```

ไม่เปลี่ยนความหมาย `expenseCapabilities.canCreate` เพราะ wizard และ flow อื่นยังต้องใช้ authority เดิม ให้ส่งผลของ predicate แยกจาก capabilities

### 6.3 Revalidation และ company switching

- เพิ่มเฉพาะ boolean นี้ใน `accessContextFingerprint` ไม่ใส่รายการ feature เพื่อไม่ให้การเปลี่ยนสิทธิ์ที่ไม่เกี่ยวสั่ง `router.refresh()` ทุกแท็บของร้าน
- ใช้ focus/visibility/`ACCESS_CONTEXT_STALE_EVENT`/poll **60 วินาที** เดิม ไม่เพิ่ม timer หรือ websocket
- การเปลี่ยนค่านี้ต้องอัปเดตเมนูแม้ permission array ไม่เปลี่ยน และต้องไม่ทำให้ใครหลุดจากระบบ
- ไม่มีคำรับรองว่าปิดแล้วหายทุกแท็บทันที: หน้าที่โหลดใหม่ใช้ค่าล่าสุด แท็บที่เปิดอยู่ปรับเมื่อ revalidate สำเร็จ แท็บที่ซ่อนอยู่ปรับเมื่อกลับมาแสดง
- company switch เป็นการเปลี่ยน route จึงประเมินใหม่เสมอ ห้ามนำค่าของบริษัท A ไปใช้กับบริษัท B

## 7. Admission ของหน้า manual และการรักษางานค้าง

### 7.1 Admission คืออะไร และอยู่ที่ไหน

Admission คือการตัดสินว่า “หน้านี้เปิดฟอร์มให้หรือไม่” ในเบราว์เซอร์ **เป็นสถานะหน้าจอ ไม่ใช่การปฏิเสธของ server และไม่ใช่ขอบเขตความปลอดภัย**

- server route `/expenses/manual` โหลด session ด้วย `fetchServerSession` แบบ no-store เดิม แล้ว **render gate และฟอร์มเสมอ** โดยส่งผลของ `canOpenManualWeb` เป็น prop server ไม่ตอบ 403 และไม่ redirect เพราะค่านี้
- gate เป็น client component ที่ครอบเฉพาะ `ManualExpensePanel` ตัดสินจาก prop: เมื่อ prop เป็นแสดง ให้รับเข้า เปิดฟอร์ม และจำผลไว้ โดยไม่ถอนเมื่อ prop เปลี่ยนเป็นซ่อนภายหลัง เมื่อ prop เป็นซ่อนและยังไม่เคยรับเข้า ให้แสดงสถานะ “ร้านซ่อนหน้านี้ไว้” และถ้า prop กลับเป็นแสดงระหว่างที่ผู้ใช้อยู่ในสถานะนั้น ให้รับเข้าได้โดยไม่ต้องโหลดหน้าใหม่
- ผลรับเข้าเก็บใน state ของ gate เท่านั้น ไม่เก็บลง storage, cookie หรือ server
- alias `/expenses?tab=manual`, deep link ผ่านหน้า login และลิงก์กลับจากหน้าตั้งค่ารหัสภาษี ลงที่ route เดียวกันจึงผ่าน gate เดียวกัน
- generic `canAccessWorkspacePath` เป็น permission gate ของโมดูลตามเดิม ห้ามใช้ค่านี้ปิด module shell หรือไล่ผู้ใช้ไป dashboard
- ไม่ต้องใส่ `prefetch={false}` ที่ลิงก์ เพราะหน้า dynamic ไม่ถูก prefetch เต็มอยู่แล้ว
- ข้อจำกัดที่ยอมรับ: การกด Back/Forward กลับมาหน้าที่เบราว์เซอร์จำไว้ก่อนร้านซ่อนเมนู อาจยังเห็นฟอร์มจนกว่าจะโหลดหน้าใหม่ ไม่สร้างกลไกเพิ่มเพื่อปิดกรณีนี้ เพราะ API รับการบันทึกตามสิทธิ์เดิมอยู่แล้ว ถ้าภายหลังเปิดใช้ `cacheComponents` ของ Next ต้องทบทวนข้อนี้ใหม่

### 7.2 ฟอร์มที่เปิดอยู่แล้ว **(ข้อเสนอ D6 รอเจ้าของยืนยัน)**

- เมื่อ gate รับเข้าแล้ว การซ่อนเมนูภายหลังไม่ unmount ฟอร์ม ไม่เคลียร์ `items`, ค่าบริการ, ภาษี, ไฟล์ที่เลือก, `savedExpenseId` และไม่สร้าง idempotency key ใหม่ (state ใน `ExpensesPages.tsx:2666-2688`)
- ผู้ใช้บันทึกรายการที่กำลังกรอกได้ตาม API permission เดิม และแนบไฟล์หลังสร้างต่อได้
- แสดงข้อความสุภาพได้ว่า “ร้านซ่อนหน้านี้แล้ว คุณยังบันทึกรายการที่กำลังกรอกได้”
- เมื่อออกจากหน้า, โหลดหน้าใหม่, เปลี่ยนบริษัทหรือผู้ใช้ หรือเปิดแท็บใหม่ ต้องประเมินใหม่
- ข้อจำกัดที่ยอมรับ: ถ้าเบราว์เซอร์โหลดหน้าใหม่เอง (มือถือสลับแอป, LINE in-app browser) ถือเป็นการเข้าใหม่และไม่เปิดฟอร์มเมื่อร้านซ่อนเมนู ข้อมูลที่ยังไม่บันทึกหายตามพฤติกรรมเดิมของเบราว์เซอร์
- permission, company หรือ session ที่ถูกถอนจริงยังมีผลตามเดิม ห้ามใช้ admission ข้าม API authorization
- server ต้องไม่สลับ subtree ของหน้าเพราะค่านี้เปลี่ยน มิฉะนั้น `router.refresh()` จะทำให้ฟอร์มหายซ้ำอาการ F08
- ไม่เพิ่ม persistent draft store และไม่ส่งข้อมูลไป server อัตโนมัติ

Acceptance ต้องทดสอบ: กรอกข้อมูลและเลือกไฟล์ → ผู้ดูแลซ่อนเมนูจากอีก session → focus/poll → ฟอร์มอยู่ → บันทึกครั้งเดียวสำเร็จ → โหลดหน้าใหม่แล้วไม่เปิดฟอร์ม

## 8. Admin UI และข้อความ

แสดงโครงสร้างดังนี้ในหน้าแพ็กเกจและฟีเจอร์ของร้าน โดยสวิตช์หลักคง label และความหมายเดิม

```text
ค่าใช้จ่ายและใบเสร็จ
  บันทึกด้วยมือ                         [สวิตช์เดิม อยู่ในชุดสิทธิ์]
    แสดงเมนูบันทึกด้วยมือบนเว็บ          [สวิตช์ใหม่ บันทึกแยก]
```

- สวิตช์ใหม่ **ไม่อยู่ในรายการเปลี่ยนแปลงของชุดสิทธิ์** ไม่ผ่านปุ่ม “ตรวจสอบและบันทึก”, ชุดสำเร็จรูป, เปิดปิดทั้งกลุ่ม หรือ `toggleSubmenu` กดแล้วบันทึกผ่าน command ใน §5.3 ทันทีหลังยืนยัน
- ใช้ได้กับทุกร้าน รวมร้านเดิมที่ยังไม่มีแถว และร้านที่ชุดสิทธิ์ยังรอการเตรียม เพราะไม่ขึ้นกับชุดสิทธิ์
- เมื่อ `expenses` หรือ `expenses.manual` ที่บันทึกแล้วของร้านปิดอยู่: แสดงค่าที่เก็บไว้แบบกดไม่ได้ ไม่แก้ค่าที่เก็บ
- ไม่เพิ่ม navigation item, route หรือแถวเมนูใหม่ในรายการเมนูของร้าน

ข้อความบนหน้าจอ **(ข้อเสนอ D3, D6, D7 รอเจ้าของยืนยัน)**

| จุด | ข้อความ |
| --- | --- |
| ชื่อสวิตช์ | แสดงเมนูบันทึกด้วยมือบนเว็บ |
| คำอธิบายใต้สวิตช์ | ปิดเพื่อซ่อนเมนูและปุ่มที่พาไปหน้าบันทึกด้วยมือบนเว็บเท่านั้น ไม่ได้ห้ามการบันทึกรายจ่ายด้วยมือ พนักงานยังบันทึกผ่านใบรับรองแทนใบเสร็จ การพิมพ์ใน LINE และการแก้รายการเดิมได้ตามสิทธิ์เดิม |
| ยืนยันก่อนซ่อน | ซ่อนเมนูบันทึกด้วยมือของร้านนี้ใช่ไหม พนักงานที่กำลังกรอกอยู่จะบันทึกต่อได้ แต่ถ้าหน้าเว็บถูกโหลดใหม่จะกลับเข้าหน้านี้ไม่ได้ แนะนำให้ปิดนอกเวลางาน |
| คำเตือนเพิ่มเมื่อร้านปิดอัปโหลดใบเสร็จอยู่ | ร้านนี้ปิดอัปโหลดใบเสร็จอยู่ ถ้าซ่อนเมนูนี้ด้วย พนักงานจะไม่มีปุ่มสร้างรายจ่ายบนเว็บ |
| กดไม่ได้เพราะฟีเจอร์แม่ปิด | เปิดฟีเจอร์บันทึกด้วยมือก่อน จึงจะตั้งค่านี้ได้ |
| บันทึกสำเร็จ | ซ่อนเมนูบันทึกด้วยมือแล้ว / แสดงเมนูบันทึกด้วยมือแล้ว |
| ค่าเปลี่ยนไปแล้วระหว่างเปิดหน้า | ค่านี้ถูกเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่ก่อนบันทึกอีกครั้ง |
| พนักงานเปิดหน้าที่ถูกซ่อน | ร้านของคุณซ่อนหน้าบันทึกด้วยมือไว้ |
| ปุ่มใต้ข้อความนั้น (แสดงเฉพาะที่ผู้ใช้มีสิทธิ์) | อัปโหลดใบเสร็จ · ไปหน้ารายการค่าใช้จ่าย |
| เมื่อไม่มีปุ่มใดให้แสดง | กรุณาติดต่อผู้ดูแลร้านของคุณ |
| ฟอร์มที่เปิดค้างหลังถูกซ่อน | ร้านซ่อนหน้านี้แล้ว คุณยังบันทึกรายการที่กำลังกรอกได้ |
| หมายเหตุในคู่มือ | ร้านของคุณซ่อนเมนูนี้ไว้ ขั้นตอนในหัวข้อนี้จึงยังใช้ไม่ได้ในขณะนี้ |

- สถานะที่พนักงานเห็นต้องไม่ใช้ข้อความ “ไม่มีสิทธิ์” เพราะไม่ใช่เรื่องสิทธิ์ และต้องไม่เสนอปุ่มที่ผู้ใช้เปิดไม่ได้
- ห้ามมีข้อความใดบอกว่าระบบหลังบ้านถูกปิด หรือบอกว่าพนักงานบันทึกด้วยมือไม่ได้
- Switch มี accessible name, focus และ aria-checked ปุ่มที่ถูกซ่อนไม่เหลือ keyboard focus target

## 9. ทางเข้าบนเว็บทุกจุด

เลขบรรทัดอ้างจาก `ae13970b0` ให้ใช้ชื่อ symbol เมื่อไฟล์เปลี่ยน ชื่อไฟล์ในตารางเป็นชื่อย่อ path เต็มของทุกจุดอยู่ใน[รีวิวอิสระ หัวข้อ 3](../research/manual-expense-web-entry-flag-review-2026-10-01-th.md)

### 9.1 ต้องซ่อนเมื่อร้านซ่อนเมนู (ใช้ `canOpenManualWeb`)

| จุด | ตำแหน่ง | พฤติกรรม |
| --- | --- | --- |
| เมนูย่อยใน sidebar (desktop และมือถือ) | `web-core-workspace.logic.ts:266-274` (`buildNavItems`) | ซ่อนรายการ “บันทึกด้วยมือ” รายการอื่นคงเดิม |
| ปุ่ม “บันทึกเอง” บนหน้ารายการ | `ExpensesPages.tsx:2453` | ซ่อน |
| หน้า `/expenses/manual` และ alias `?tab=manual` | `expenses/manual/page.tsx`, `ExpensesPages.tsx:2916-2925,2972` | ผ่าน gate ใน §7 |
| ปุ่ม “กรอกรายจ่ายเอง” ในสมุดรายรับรายจ่าย | `IncomeExpenseLedgerPage.tsx:642` | ซ่อน |
| เงื่อนไขแสดงการ์ด “เพิ่มรายการใหม่” | `IncomeExpenseLedgerPage.tsx:635` | ใช้ helper เดียวกัน ไม่เหลือการ์ดเปล่า |
| empty state “กรอกรายจ่ายรายการแรก” | `IncomeExpenseLedgerPage.tsx:408-412` | ไม่เสนอเมื่อซ่อน |
| การ์ด “บันทึกค่าใช้จ่ายด้วยมือ” ในหน้า AI แนะนำ | `ai-suggestions.logic.ts:168` | ไม่แสดง |
| ลิงก์กลับจากหน้าตั้งค่ารหัสภาษี | `TransactionTaxLineSelector.tsx:88-94` | ลงที่ gate |
| ปุ่ม “เปิดหน้าบันทึกด้วยมือ” ในคู่มือ และหัวข้อ “บันทึกด้วยมือ” | `expenses-guide.content.ts:228-262` | ดู §9.3 |

### 9.2 คงไว้โดยเจตนา

| จุด | ตำแหน่ง | เหตุผล |
| --- | --- | --- |
| ลิงก์ “ไม่มีไฟล์ใบเสร็จ/ใบกำกับภาษี? …” ในหน้าอัปโหลด | `ExpensesPages.tsx:615-617,2971` | พาไป wizard ใบรับรองแทนใบเสร็จ ไม่ใช่หน้า manual เจ้าของให้คง wizard |
| สร้างรายการใหม่ใน wizard ใบรับรองแทนใบเสร็จ | `SubstituteReceiptWizardPage.tsx:1716,1760` | คง permission และ state เดิมทั้งหมด |
| กรอกแก้ผล OCR ในหน้ารายละเอียด | `ExpensesPages.tsx:1136` | ไม่ใช่ทางเข้าหน้า manual |
| พิมพ์รายจ่ายใน LINE และลิงก์เว็บในคำตอบ LINE | `expense-document.use-case.ts:106,212` | LINE ไม่เปลี่ยน ลิงก์ทั้งหมดไปหน้ารายการหรือรายละเอียด ไม่มีลิงก์ไปหน้า manual |
| API `POST /v1/companies/:companyId/expenses` | `expense.controller.ts:237-238` | สวิตช์ไม่ใช่การห้าม |
| แจ้งเตือน แดชบอร์ด LINE rich menu | ตรวจแล้วไม่มีลิงก์ไปหน้า manual | ไม่มีสิ่งต้องซ่อน |

### 9.3 คู่มือและคำตอบของผู้ช่วย **(ข้อเสนอ D4 รอเจ้าของยืนยัน)**

- คู่มือบนเว็บ: เมื่อร้านซ่อนเมนู ไม่แสดงปุ่ม “เปิดหน้าบันทึกด้วยมือ” และแสดงหมายเหตุตาม §8 ที่ต้นหัวข้อ “บันทึกด้วยมือ” ไม่ลบหัวข้อ เพราะคู่มืออ้างเลขหัวข้อและจำนวนเมนูย่อย
- **ไม่แก้ `expenses-guide.content.ts`** เพราะไฟล์นี้ถูกตรึง hash โดย `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts:5` และ `approved-knowledge.spec.ts:34` จะแดงเมื่อไฟล์เปลี่ยน ให้แปลงผลลัพธ์ของ `buildExpensesGuide` ในไฟล์ใหม่ แล้วเรียกจาก `user-guide/expenses/page.tsx` ถ้าจำเป็นต้องแก้ไฟล์คู่มือจริง ให้ทำขั้นตอน hash ใน plan §4
- คำตอบของผู้ช่วยใน LINE (การ์ด `expense.start`) ยังกล่าวถึงบันทึกด้วยมือ รอบนี้ไม่แก้ บันทึกเป็นข้อจำกัด และปรับถ้อยคำในรอบทบทวนชุดคำตอบครั้งถัดไป
- คู่มือฉบับเอกสารที่อยู่นอก repo ไม่อยู่ในขอบเขต

### 9.4 Test ที่อ้างทางเข้านี้

e2e ที่เปิดหน้า manual (`e2e/expenses.spec.ts`, `transaction-tax.spec.ts`, `transaction-branch.spec.ts`, `settings.spec.ts`, `evidence.spec.ts`, `responsive.spec.ts`, `local-active-feature-regression.spec.ts`, `expense-number-save.spec.ts`) และตารางความคาดหวังเมนู (`e2e/harness/roles.ts:153`) ต้องยังผ่านโดยไม่แก้ เพราะค่าเริ่มต้นคือแสดง ต้องเพิ่ม e2e ใหม่สำหรับกรณีซ่อน

ใช้ server session ส่งผลของ predicate ตาม prop chain ที่มีอยู่ ไม่เพิ่ม global auth framework หรือ query ต่อปุ่มแต่ละตัว

## 10. แพ็กเกจ ชุดสำเร็จรูป ดีล และการเปิดร้านใหม่ **(ข้อเสนอ D2 รอเจ้าของยืนยัน)**

ค่าตั้งนี้อยู่นอกชุดสิทธิ์ จึงไม่มีโค้ดใดในกลุ่มนี้ต้องแก้ สิ่งที่ต้องพิสูจน์ด้วย test คือ **ไม่มีการอ่านหรือเขียนค่านี้** จาก

1. `applyPreset`, เปิดปิดทั้งกลุ่ม, เปิดปิดการ์ดเมนู และรายการเปลี่ยนแปลงของชุดสิทธิ์ในหน้าผู้ดูแล
2. `billingFeaturePlan`, `applyBillingFeaturePlan`, `movePlanMenus` และ snapshot ของดีล
3. `CreateCompanyOnboardingUseCase` และการสมัครร้านใหม่ทุกทาง
4. `normalize-entitlements` ทั้งโหมด plan, apply และ verify

และการสลับค่านี้ต้องไม่เปลี่ยน `billingFeaturePlan().sourceHash` ของร้าน เพื่อให้ plan ที่ลูกค้า pin ไว้ตอนเปิดหน้าชำระเงินยัง apply ได้หลังจ่าย

ไม่แก้ preset semantics ของ `expenses.manual` หรือ feature อื่นในงานนี้

## 11. Separate follow-up A — Delete permission mismatch **(ข้อเสนอ D8 รอเจ้าของยืนยัน)**

**ไม่อยู่ใน implementation ของงานนี้** รายละเอียด ทางทำซ้ำ และ test อยู่ใน[เอกสารบั๊ก B1](../research/manual-expense-current-code-bugs-2026-10-01-th.md)

สรุป: controller `DELETE /companies/:companyId/expenses/:expenseId` บังคับ `expense.update` แต่ use case ยอมรับ `expense.delete` หรือ `expense.update` ของเจ้าของร่าง ผู้ได้รับผลคือบทบาทที่สร้างจากเทมเพลต `tpl.x.finance`, `tpl.trading.finance`, `tpl.service.finance`, `tpl.ecom.finance` ซึ่งได้ `expense.delete` จาก `pack.expense.finance` โดยไม่มี `expense.update` บทบาท FINANCE, ADMIN และ OWNER ในระบบไม่ได้รับผลเพราะมีทั้งสองสิทธิ์

งานสวิตช์ต้องไม่ทำให้พฤติกรรมนี้เปลี่ยน ไม่ว่าทางดีขึ้นหรือแย่ลง

## 12. LINE draft idempotency — ปิดแล้ว

บั๊กที่ v2.0 เรียกว่า F03 ถูกแก้ใน `6fddca795` (2026-09-29) ก่อนเอกสาร v2.0 ถูก merge ข้อเสนอ SHA-256 64 ตัวและ compatibility lookup ของ v2.0 **ถูกถอน** สูตรปัจจุบัน (`line-draft-<event id>` หรือ hash 53 ตัวเมื่อ id ไม่เข้ารูป) คือสัญญาที่ใช้งานอยู่ ห้ามเปลี่ยนในงานนี้

- key รูป `line-draft:` ไม่เคยบันทึกลงฐานข้อมูลได้ เพราะ validator ถูกเพิ่มใน commit เดียวกับที่เริ่มใช้ key รูปนั้น (`3d7379ef`) จึงไม่มีข้อมูลเก่ารูปนั้นต้องรองรับ
- ผล “400 ทั้งสี่ครั้ง” ใน evidence เป็นของฐานโค้ดเก่า ห้ามใช้เป็นค่าคาดหวัง
- ถ้าจะเพิ่ม integration test แบบ compose จริงของ LINE note ให้ทำเป็นงานแยก และยืนยันสูตรปัจจุบัน

## 13. Neighbor module boundaries

| Module | Boundary / acceptance |
| --- | --- |
| Employee access / resolver | ไม่ถูกแก้ ค่าตั้งใหม่ไม่อยู่ใน `ResolvedAccess` และไม่เปลี่ยน permissions หรือ `entitledFeatureKeys` |
| Auth / web session | field additive ค่าเดียว ผูกกับบริษัทที่ร้องขอ ค่าหายถือว่าแสดง auth/privacy guards เดิม |
| LINE gateway/AgentCore | ไม่ถูกแก้ การสลับค่าต้องไม่เรียก `invalidateLineConversationState` และไม่เปลี่ยน `lineDeliveryAccessFingerprint` บทสนทนา รูปที่รอคำตอบ และคำตอบที่รอส่งต้องคงอยู่ |
| ชุดคำตอบ LINE (`approved-product-help.ts`) | ไม่แก้เนื้อหา ไม่ทำให้ hash ของไฟล์คู่มือเปลี่ยน (§9.3) |
| LINE edit/correction | `expense.update` เดิมทำให้ preview/apply/edit hints คงเดิม |
| Receipt OCR / quotas | OCR off/failed/quota-full ยังแก้ draft ที่ upload แล้วเองได้ ไม่พาไปปุ่มที่ถูกซ่อน |
| Capture group / handoff | ไม่อ่านค่านี้ |
| Substitute certificate/signatures | การสร้าง manual expense ภายใน wizard, signed versions, payer/evidence ownership และ linked source state เดิม |
| Reimbursements | claim draft/approve/payout/materialize ไม่พึ่งทางเข้าเว็บ ห้ามเพิ่ม gate ที่ shared repository |
| Payments / ledger / tax | ไม่มี schema, account, amount, VAT หรือ numbering เปลี่ยนจากค่านี้ |
| Billing / แพ็กเกจ / ดีล | ไม่อ่านและไม่เขียนค่านี้ การสลับค่าไม่เปลี่ยน `setVersion` หรือ `sourceHash` (§10) |
| Onboarding / normalizer | ไม่อ่านและไม่เขียนค่านี้ ไม่มีแถว = แสดง |
| Dashboard/notifications/report/export | ห้ามกรอง records ที่ `captureSource=WEB_MANUAL` เพราะร้านซ่อนเมนู |
| W00 capability manifest / reliability corpus | ไม่ควรถูกแตะ เพราะไม่แก้ `feature-entitlements.ts`, `menu-entitlements.ts` หรือไฟล์ LINE ถ้า diff แตะไฟล์ที่ manifest เก็บ hash ให้ทำตาม plan §4 |

## 14. State, concurrency, audit และข้อจำกัดที่ตั้งใจ

- ไม่มี ExpenseRecord state transition จากการสลับค่า ไม่มี archive/delete/reclassify/re-number/backfill
- CAS ของค่านี้เป็นของตัวเอง (`expectedVersion`): ผู้ดูแลที่ถือค่าเก่าได้ 409, ค่าเท่าเดิมเป็น no-op
- ไม่ใช้และไม่ bump `CompanyEntitlementSet.setVersion` จึงไม่ชนกับการแก้ชุดสิทธิ์ที่ทำพร้อมกัน และไม่ทำให้การชำระเงินที่ค้างอยู่ถูกพัก
- ไม่เพิ่ม transaction lock หรือ backend fence ให้การสร้างรายจ่าย เพราะขอบเขตนี้ควบคุมทางเข้าเว็บ ไม่ได้ห้าม backend creation
- ซ่อนเมนูแข่งกับ request ที่ส่งไปแล้ว: API ทำตาม permission เดิม ถือว่า expected ไม่สัญญา “ไม่มีรายจ่ายใหม่หลังเวลาที่ซ่อน”
- การปิดฟีเจอร์แม่หรือ revoke role เป็นคนละ authority ต้องไม่ถูก admission ยกเว้นให้
- audit ตาม §5.4 การแสดงหรือซ่อนเมนูให้ผู้ใช้ไม่สร้าง audit

## 15. Compatibility, rollout และ rollback

มี migration แบบ additive หนึ่งรายการ ไม่มี permission migration และไม่เปลี่ยน semantics ของ key ใด

1. web และ API ออกเป็น image เดียว (`infra/api-web/Dockerfile.api-web`) จึงขึ้นและถอยพร้อมกัน ช่วงสลับรุ่นสั้น ๆ: เว็บใหม่กับ API เก่าได้ field หายและถือว่าแสดง เว็บเก่ากับ API ใหม่ไม่อ่าน field และแสดงเมนูตามเดิม
2. ลำดับ: migration → API (command, รายละเอียดร้าน, `/auth/me`) → web (helper, gate, ทางเข้า, หน้าผู้ดูแล) ใน release เดียวกัน
3. ข้อมูลเดิมของร้าน สิทธิ์ รายจ่าย และภาษี ไม่ถูกเปลี่ยนจาก deployment
4. Rollback: ถอย image แล้วทุกร้านกลับมาเห็นเมนู เพราะโค้ดเก่าไม่อ่านค่านี้ ตารางใหม่ถูกปล่อยไว้ ไม่มีโค้ดเก่าใดอ่านตารางนี้ ไม่กระทบ billing, LINE หรือ normalizer ค่าที่ผู้ดูแลตั้งไว้ยังอยู่และมีผลอีกครั้งเมื่อขึ้นรุ่นใหม่ ให้บันทึกข้อจำกัดนี้ใน release handoff
5. ไม่มีขั้นตอน “เปิดให้ใช้ทีหลัง” ด้วย environment switch สวิตช์ใช้ได้ทันทีที่ release ขึ้น

ก่อน cloud inspection อ่าน [cloud operations](../runbooks/cloud-environment-operations.md); ก่อน deploy/promotion/customer-gate change/retry อ่าน [mandatory deployment protocol](../runbooks/uat-production-v2-deployment.md) งานนี้ไม่อนุญาต deploy หรือเปลี่ยนค่าของลูกค้า

## 16. Acceptance criteria

| ID | เงื่อนไขผ่าน |
| --- | --- |
| AC01 | ค่าตั้งใหม่เป็นของร้าน ร้านที่ไม่มีแถวอ่านได้ว่าแสดง ไม่มีการเปลี่ยนใน `FEATURE_CATALOG`, `ALL_FEATURE_ENTITLEMENT_KEYS`, bindings หรือ presets |
| AC02 | permissions ทุกตัวของทุกบทบาทและทุกเทมเพลต และ `entitledFeatureKeys` เท่าเดิมเมื่อสลับ แสดง→ซ่อน→แสดง |
| AC03 | `/auth/me` คืน `manualExpenseWebEntry` ตามบริษัทที่ร้องขอ ร้านไม่มีแถวได้ true และเว็บถือว่าแสดงเมื่อ field หาย |
| AC04 | ทุกจุดใน §9.1 ไม่แสดงเมื่อร้านซ่อนเมนู ทุกจุดใน §9.2 คงอยู่ |
| AC05 | URL ตรง, alias, ลิงก์กลับจากหน้าภาษี และ deep link ผ่าน login ลงที่ gate เดียวกัน เมื่อซ่อนไม่เปิดฟอร์ม และไม่มี HTTP 403 หรือ redirect จากค่านี้ |
| AC06 | ฟอร์มที่รับเข้าแล้วอยู่ต่อหลังค่านี้เปลี่ยนและ `router.refresh()` บันทึกครั้งเดียวได้ โหลดหน้าใหม่แล้วไม่เปิดฟอร์ม |
| AC07 | fingerprint เปลี่ยนเมื่อค่านี้เปลี่ยนแม้ permissions เท่าเดิม ไม่เปลี่ยนจากการเปลี่ยนชุดสิทธิ์ที่ไม่กระทบ permissions และไม่เกิด refresh loop |
| AC08 | สลับบริษัทหรือผู้ใช้แล้วไม่ใช้ผลรับเข้าหรือค่าข้ามบริษัท |
| AC09 | API create/update/delete/mark-ready ให้ผลเดิมทุกบทบาททั้งสองสถานะ no-permission/cross-tenant/cross-branch ยัง deny |
| AC10 | upload, OCR-failed, quota-full, แก้ร่างของตน, wizard ใบรับรองแทนใบเสร็จ และ reimbursement ทำได้ตามเดิม |
| AC11 | การสลับค่าไม่เรียก `invalidateLineConversationState` ไม่เปลี่ยน `lineDeliveryAccessFingerprint` บทสนทนา รูปที่รอคำตอบ และคำตอบที่รอส่งของ LINE คงอยู่ |
| AC12 | การสลับค่าไม่เปลี่ยน `CompanyEntitlementSet.setVersion` และ `billingFeaturePlan().sourceHash` plan ที่ pin ก่อนสลับ apply ได้และ invoice ไม่ HELD |
| AC13 | ซื้อ อัปเกรด ดีล ชุดสำเร็จรูป onboarding และ normalizer ไม่อ่านและไม่เขียนค่านี้ ค่าคงเดิมหลังเหตุการณ์เหล่านั้น |
| AC14 | ผู้ดูแลเห็นสวิตช์ใต้ “บันทึกด้วยมือ” เปิดปิดได้กับร้านเดิมทุกแบบ กดไม่ได้เมื่อฟีเจอร์แม่ปิด และไม่อยู่ในรายการเปลี่ยนแปลงของชุดสิทธิ์ |
| AC15 | command: ค่าเท่าเดิมเป็น no-op, version เก่าได้ 409, ร้านที่ล็อกถูกปฏิเสธ, การเปลี่ยนจริงมี audit หนึ่งแถว |
| AC16 | ข้อความทุกจุดตรงกับ §8 มีคำเตือนเมื่อร้านปิดอัปโหลดใบเสร็จ และไม่มีข้อความว่าระบบหลังบ้านถูกปิดหรือพนักงานไม่มีสิทธิ์ |
| AC17 | คู่มือ: ปุ่มหายและมีหมายเหตุเมื่อซ่อน `expenses-guide.content.ts` ไม่เปลี่ยน และ `approved-knowledge.spec.ts` ยังเขียว |
| AC18 | loading/disabled/error/keyboard/มือถือ 390px ครบ ไม่มี blank redirect loop |
| AC19 | migration เป็น additive ร้านเดิมไม่ต้อง backfill และถอย image ได้ตาม §15 ข้อ 4 |
| AC20 | หลักฐานมาจาก candidate ที่เริ่มจาก develop ล่าสุด ผล E2E เดิมไม่ถูกนับ บั๊กแยกและ baseline UI failures ระบุแยก |

## 17. Out of scope และ definition of done

ไม่สร้าง global kill switch, ไม่หยุด LINE หรือ manual API, ไม่ปิด wizard, ไม่เพิ่ม permission, SKU หรือ entitlement key, ไม่ปรับเงินหรือภาษี, ไม่เปลี่ยน parent launch หรือ runoff policy, ไม่แก้ชุดคำตอบ LINE, ไม่สร้างที่เก็บร่างฟอร์ม และไม่แก้บั๊กใน[เอกสารบั๊กแยก](../research/manual-expense-current-code-bugs-2026-10-01-th.md)

เริ่ม implement ได้เมื่อเจ้าของยืนยัน D1–D8 และสถานะเอกสารถูกเปลี่ยนตามนั้น Implementation complete เมื่อ AC01–AC20 มีหลักฐานตาม plan, spec/plan/memory อัปเดตสถานะจริง และระบุ live evidence ที่ยังค้างอย่างตรงไปตรงมา การจบ **งานเอกสารรอบนี้** หมายถึงเอกสารพร้อมให้เจ้าของตัดสินเท่านั้น

## ภาคผนวก A — สิ่งที่เปลี่ยนจาก v2.0 และเหตุผล

รหัส RM อ้างถึง[รีวิวอิสระ](../research/manual-expense-web-entry-flag-review-2026-10-01-th.md)

| เรื่อง | v2.0 | v3.0 | เหตุผล |
| --- | --- | --- | --- |
| สถานะเอกสาร | READY FOR IMPLEMENTATION | PROPOSAL รอเจ้าของยืนยัน D1–D8 | RM-01, RM-08 |
| ฐานโค้ด | `4a5817b42` (ไม่ใช่บรรพบุรุษของ develop) | `ae13970b0` และต้องตรวจซ้ำที่ commit เริ่มงาน | RM-01 |
| ที่เก็บสวิตช์ | key `expenses.manual.web_entry` ใน `FEATURE_CATALOG` | ค่าตั้งรายร้านแยกจากชุดสิทธิ์ | RM-03, RM-04, RM-05, RM-06, RM-07, RM-08, RM-17 |
| ค่าเริ่มต้น | “ไม่มีแถว = เปิด” แต่ onboarding/billing/preset/ดีลจะเขียนปิด | ไม่มีแถว = แสดง และไม่มีผู้เขียนอื่นนอกจาก command ของผู้ดูแล | RM-04 |
| ร้านเดิม | หน้าผู้ดูแลบล็อกการปิด | ปิดได้ทุกร้านผ่าน command เฉพาะ | RM-05 |
| ผลต่อ LINE และการชำระเงิน | ใช้ command สิทธิ์เดิม ซึ่งล้างสถานะ LINE และ bump `setVersion` | ไม่แตะชุดสิทธิ์ จึงไม่กระทบทั้งสอง | RM-06, RM-07 |
| สัญญา session | ส่ง `entitledFeatureKeys` ทั้งรายการ สามสถานะ | boolean ค่าเดียว | RM-12 |
| ค่าที่อ่านไม่ได้ | ไม่รับเข้า แสดง retry | ถือว่าแสดง | RM-12 |
| Admission | “revalidate เมื่อ stale/back-navigation” | ตัดสินจาก prop ที่ server ส่งมาและจำผลไว้ในหน้า เป็นสถานะหน้าจอ ระบุข้อจำกัด back/forward และมือถือ | RM-13, RM-14 |
| ข้อความผู้ดูแล | ไม่บอกว่ายังบันทึกด้วยมือได้ทางอื่น ไม่มีจุดประสงค์ | บอกชัดว่าไม่ใช่การห้าม มีคำเตือนก่อนปิด | RM-15, RM-16 |
| รายการทางเข้า | ขาดการ์ดเปล่าใน ledger, หัวข้อคู่มือ, คำตอบ LINE, e2e | รายการครบใน §9 | RM-10, RM-11 |
| คู่มือ | แก้ `expenses-guide.content.ts` | ไม่แก้ไฟล์ที่ถูกตรึง hash ใช้การแปลงผลลัพธ์ | RM-10 |
| F03 | งานค้าง พร้อมข้อเสนอเปลี่ยนสูตร key | ปิดแล้ว ห้ามเปลี่ยนสูตร | RM-02 |
| F02 | “role finance ที่มี delete แต่ไม่มี update” | บทบาทจากเทมเพลตการเงินสี่แบบ ย้ายรายละเอียดไปเอกสารบั๊ก | RM-20 |
| F07 | Target “รักษาค่า manual เมื่อใช้ preset” ขัดกับ §10 | ไม่เกี่ยวกับงานนี้แล้ว | RM-22 |
| Rollback | “กระทบเพียงการแสดงเมนู” ทั้งที่แถวใหม่ทำให้ billing รุ่นเก่าปฏิเสธ | ถอยได้โดยปล่อยตารางไว้ ไม่มีผลข้างเคียง | RM-18 |
| `prefetch={false}` | แนะนำให้ใส่ | ตัดออก | RM-24 |
| Plan | ไม่มี W00 manifest, ชุดคำตอบ, ไฟล์ที่ถูกตรึง, ลำดับ commit | อยู่ใน plan ฉบับแก้ | RM-09, RM-19 |
| หลักฐาน | harness ถูกอ้างเป็นจุดเริ่ม | ระบุว่าเป็นหลักฐานของ key เดิมบนฐานเก่าเท่านั้น | RM-21 |

ข้อที่ไม่ใช้กับ v3.0 แล้ว: RM-23 (`toggleSubmenu` เปิด parent) เพราะสวิตช์ใหม่ไม่ผ่าน `toggleSubmenu` แต่ยังเป็นกติกาใน §8 ว่าห้ามผ่าน · ข้อที่ยังไม่ได้แก้ในเอกสารชุดนี้: RM-25 (memory `manual-expense-multi-item` อยู่นอกรายการไฟล์ที่ได้รับมอบหมายให้แก้)

## ภาคผนวก B — ถ้าเจ้าของต้องการให้เป็น key ใน catalog (ทางเลือกของ D1)

ทางเลือกนี้ทำได้ แต่ต้องสร้างเพิ่มทั้งหมดต่อไปนี้ใน release เดียวกับการเพิ่ม key มิฉะนั้นจะเกิดผลตามคอลัมน์ขวา ผลในคอลัมน์ขวามาจากการรันโค้ดจริงของผู้รีวิว ยกเว้นแถวที่ระบุว่าอ่านโค้ด

| ต้องสร้างเพิ่ม | ไฟล์หลัก | ถ้าไม่ทำ |
| --- | --- | --- |
| ให้ billing รับชุดแถวของร้านเดิม (60 และ 62 แถว) เมื่อ catalog โตเป็น 63 และ apply plan ที่ pin ก่อน deploy ได้ ห้ามแก้ด้วยการเปลี่ยนเลข 62/60 เป็น 63/61 | `billing-feature-entitlements.ts:14,51-59,113` | ร้านเดิมซื้อครั้งแรก ซื้อใหม่หลังหมดอายุ ซื้อดีล และอัปเกรดไม่ได้ เงินที่จ่ายแล้วถูกพัก (RM-03 และ[เอกสารบั๊ก B4](../research/manual-expense-current-code-bugs-2026-10-01-th.md)) |
| กติกา “key ที่ไม่มี permission ไม่ใช่สิทธิ์เชิงพาณิชย์” ใน onboarding, billing, `movePlanMenus`, `applyPreset` และดีล: ค่า = ค่าที่เก็บอยู่ ไม่มีแถว = เปิด และไม่แสดงในรายการเมนูที่จะหยุดใช้ | `menu-entitlements.ts:432-508`, `create-company-onboarding.use-case.ts:580-591`, `billing-feature-entitlements.ts:68-100`, `system-partners.logic.ts:274-288` | ร้านใหม่และร้านที่ซื้อแพ็กเกจถูกซ่อนเมนูเองโดยไม่มีใครสั่ง (RM-04) |
| ให้หน้าผู้ดูแลปิด key ที่ร้านยังไม่มีแถวได้ | `get-partner-detail.use-case.ts:165-178`, `system-partners.logic.ts:341-362` | ปิดให้ร้านเดิมไม่ได้เลย (RM-05) |
| ให้ `SetPartnerFeaturesUseCase` ไม่ถือว่า key นี้เป็นการเปลี่ยนสิทธิ์: ไม่ล้างสถานะ LINE ไม่สร้าง run-off และไม่ให้ key นี้เข้า `entitledFeatureKeys` ของ LINE | `set-partner-features.use-case.ts:420-497,566-568`, `line-delivery-access.ts:6-19` | ทุกครั้งที่สลับ บทสนทนา LINE ของทั้งร้านถูกล้างและคำตอบที่รอส่งถูกปฏิเสธ (RM-06) |
| ป้องกันการสลับขณะร้านมีการชำระเงินค้าง หรือยอมรับความเสี่ยงเป็นลายลักษณ์อักษร | `billing-feature-entitlements.ts:101-126`, `billing-reconciler.service.ts:588-611` | ลูกค้าที่เปิดหน้าชำระเงินไว้ จ่ายแล้วแพ็กเกจไม่เปิดให้ (RM-07) |
| Regenerate W00 manifest และ reliability corpus แล้วรัน whole-chain | `line-ai-capability-manifest.ts:218-221,613`, `scripts/line-ai-reliability-corpus.ts` | CI แดง (RM-09) |
| ขั้นตอนเติมแถวให้ทุกร้านก่อนถอดกติกา “ไม่มีแถว = เปิด” ตาม decoupling spec และรับว่า `normalize-entitlements --verify` จะรายงานทุกร้านจนกว่าจะเติม | `normalize-entitlements.ts:231-305`, `feature-entitlement-decoupling-spec.md:271` | วันถอดกติกา legacy เมนูหายทุกร้านพร้อมกัน (RM-17 ส่วนของ verify รันแล้ว ส่วนของวันถอดกติกาอ่านจากสเปก) |
| แผน rollback สำหรับแถวที่เกิน catalog ของโค้ดเก่า | `billing-feature-entitlements.ts:51` | หลังถอยรุ่น ร้านที่มีแถวนี้ซื้อแพ็กเกจไม่ได้ (RM-18 อ่านโค้ด) |
| ข้อยกเว้นของกฎ “No nav-only gating” ใน `feature-entitlement-submenu-plan.md` บันทึกก่อนเขียนโค้ด | `docs/plans/feature-entitlement-submenu-plan.md:20` | เอกสารหลักขัดกับโค้ด |
| สัญญา session และ predicate ต้องอ่าน key จากชุดสิทธิ์แทน boolean ใน §6 | §6 ของเอกสารนี้ | เว็บไม่รู้ค่า |

ต้นทุนรวมของทางเลือกนี้คือการแก้โค้ดด้านเงินและ LINE ที่ใช้งานอยู่อย่างน้อยห้าจุด แลกกับการไม่มี migration ข้อเสนอ D1 จึงเลือกค่าตั้งรายร้านซึ่งมี migration หนึ่งรายการแต่ไม่แตะโค้ดด้านเงินและ LINE เลย
