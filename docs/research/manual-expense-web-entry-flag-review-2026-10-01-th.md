# รีวิวอิสระ: ชุดเอกสารสวิตช์ทางเข้าบันทึกค่าใช้จ่ายด้วยมือบนเว็บ (`expenses.manual.web_entry`)

วันที่: 2026-10-01 · ผู้รีวิว: Claude (รีวิวอย่างเดียว ไม่แก้โค้ด ไม่แก้เอกสารเดิม) · ฐานที่ตรวจ: `origin/develop` `ae13970b0`

Status: **REVIEW COMPLETE — แนะนำให้เปลี่ยนสถานะสเปกจาก READY FOR IMPLEMENTATION เป็น NEEDS REVISION ก่อนเริ่มเขียนโค้ด**

เอกสารที่รีวิว: [spec v2.0](../specs/manual-expense-web-entry-flag-spec-th.md) · [plan](../plans/manual-expense-web-entry-flag-plan-th.md) · [audit](manual-expense-web-entry-flag-audit-2026-10-01-th.md) · [E2E simulation](../qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md) · [evidence](../evidence/manual-expense-web-entry-flag-2026-10-01/README.md) · [memory](../agent-memory/manual-expense-web-entry-flag.md) · [memory multi-item](../agent-memory/manual-expense-multi-item.md)

วิธีอ่าน: เลขบรรทัด `file:line` ทุกจุดอ้างจาก commit `ae13970b0` · คำว่า "รันจริง" หมายถึงผู้รีวิวรันโค้ดจริงของ repo ในหน่วยความจำ (ไม่แก้ไฟล์ ไม่ใช้ฐานข้อมูล ไม่เรียก AI) รายละเอียดอยู่หัวข้อ 6

## 1. สรุป

จำนวนข้อค้นพบ 25 ข้อ

| ความรุนแรง | จำนวน | รหัส |
| --- | ---: | --- |
| ต้องแก้ก่อนเริ่มทำ | 8 | RM-01 ถึง RM-08 |
| ควรแก้ | 13 | RM-09 ถึง RM-21 |
| เล็กน้อย | 4 | RM-22 ถึง RM-25 |

ห้าเรื่องที่สำคัญที่สุด

1. **เอกสารทั้งชุดถูกตรวจและทดสอบบนโค้ดเก่า ไม่ใช่โค้ดที่จะลงมือทำ** ฐานที่ audit และ E2E ใช้คือ `4a5817b42` ซึ่งไม่ใช่บรรพบุรุษของ `develop` และห่างกัน 842 commit ไฟล์ที่ evidence เก็บ hash ไว้ 3,728 ไฟล์ ต่างจาก `develop` 596 ไฟล์ ผลคือข้ออ้างบางข้อไม่จริงแล้ว ที่ชัดที่สุดคือ **F03 (บั๊ก LINE) ถูกแก้ไปแล้วตั้งแต่ 2026-09-29** แต่สเปกยังเขียนเป็นงานค้างและเสนอวิธีแก้อีกแบบที่จะไปเปลี่ยนโค้ดที่ใช้งานอยู่ (RM-01, RM-02)
2. **ทำตามสเปกตรง ๆ แล้วร้านเดิมจะซื้อแพ็กเกจ ซื้อดีล หรืออัปเกรดไม่ได้ และเงินที่ลูกค้าจ่ายแล้วอาจถูกพัก** (การต่ออายุแพ็กเกจเดิมตามรอบไม่ได้รับผล) เพราะระบบชำระเงินบังคับว่าชุดแถวสิทธิ์ของร้านต้องตรงกับ catalog ทุกตัว (ปัจจุบัน 62 ตัว) การเพิ่ม key ตัวที่ 63 โดยไม่แก้ส่วนนี้ทำให้ `billingFeaturePlan` โยน `BILLING_ENTITLEMENT_REVIEW_REQUIRED` — รันจริงยืนยันแล้ว สเปกกลับระบุว่า billing "regression only ไม่แก้ production source" (RM-03)
3. **ค่าเริ่มต้นจะกลายเป็น "ปิด" เอง ตรงข้ามกับที่สเปกตั้งใจ** ร้านที่เปิดใหม่ ร้านที่ซื้อแพ็กเกจ และร้านที่ซื้อดีล จะถูกเขียนแถว `expenses.manual.web_entry=false` เพราะ key ใหม่ไม่อยู่ใน `STARTER_FEATURE_KEYS` และ test เดิมยังเขียวทั้งที่พฤติกรรมผิด (RM-04)
4. **ผู้ดูแลกดปิดสวิตช์ให้ร้านเดิมไม่ได้** หน้าจอผู้ดูแลบล็อกการปิด key ที่ร้านยังไม่มีแถวเก็บอยู่ ("ข้อมูลสิทธิ์ของฟีเจอร์นี้ยังไม่ครบ จึงยังปิดไม่ได้") ซึ่งคือร้านเดิมทุกร้าน — รันจริงยืนยันแล้ว เท่ากับฟีเจอร์ใช้ไม่ได้กับกลุ่มเป้าหมายหลัก (RM-05)
5. **การกดสวิตช์ไม่ได้ "เบื้องหลังเหมือนเดิม"** command เดิมถือว่าเป็นการเปลี่ยนสิทธิ์ จึงล้างบทสนทนา LINE ของทั้งร้าน ทำให้รูปที่ระบบถามกลับและรอคำตอบอยู่หมดอายุ ปฏิเสธคำตอบที่รอส่ง และทำให้การชำระเงินที่ลูกค้าเปิดค้างไว้ถูกพักหลังจ่าย ต้องตัดสินใจเรื่อง "จะเก็บสวิตช์ไว้ที่ไหน" ก่อนเริ่ม (RM-06, RM-07, RM-08)

ข้อดีของชุดเอกสารที่ควรคงไว้: แยก key ใหม่ออกจาก `expenses.manual` ถูกต้อง, ไม่มี environment switch, ไม่แตะ guard ฝั่ง API, ระบุชัดว่า E2E ทดสอบ key เดิมและห้ามใช้รับรอง v2, ตัวเลขผลทดสอบ 72/55/17 ตรงกับไฟล์ JSON ทุกชุด

## 2. ตารางข้อค้นพบ

### 2.1 ดัชนี

| รหัส | ความรุนแรง | ประเภท | เรื่อง | เจ้าของต้องตัดสิน |
| --- | --- | --- | --- | --- |
| RM-01 | ต้องแก้ก่อนเริ่มทำ | ข้ออ้างเกี่ยวกับโค้ดที่ไม่ตรง | ฐานโค้ดที่ตรวจเป็น branch เก่าที่แยกจาก develop | ไม่ |
| RM-02 | ต้องแก้ก่อนเริ่มทำ | ข้ออ้างเกี่ยวกับโค้ดที่ไม่ตรง | F03 แก้ไปแล้ว แต่สเปก §12 เสนอเปลี่ยนสูตร key อีกครั้ง | ไม่ |
| RM-03 | ต้องแก้ก่อนเริ่มทำ | ผลกระทบ | เพิ่ม key เข้า catalog แล้วร้านเดิมซื้อหรืออัปเกรดแพ็กเกจไม่ได้ | ไม่ |
| RM-04 | ต้องแก้ก่อนเริ่มทำ | ผลกระทบ | ค่าเริ่มต้นถูกเขียนเป็นปิดโดย onboarding, billing, preset, ดีล | ใช่ |
| RM-05 | ต้องแก้ก่อนเริ่มทำ | ช่องว่าง | ผู้ดูแลปิดสวิตช์ให้ร้านเดิมไม่ได้ | ไม่ |
| RM-06 | ต้องแก้ก่อนเริ่มทำ | ผลกระทบ | การกดสวิตช์รบกวน LINE ของทั้งร้าน | ไม่ |
| RM-07 | ต้องแก้ก่อนเริ่มทำ | ผลกระทบ | การกดสวิตช์ทำให้ใบแจ้งหนี้ที่ลูกค้าจ่ายแล้วถูกพัก | ไม่ |
| RM-08 | ต้องแก้ก่อนเริ่มทำ | ข้อผิดพลาดในสเปก | ต้องเลือกที่เก็บสวิตช์ และบันทึกข้อยกเว้นของกฎ "No nav-only gating" | ใช่ |
| RM-09 | ควรแก้ | ช่องว่าง | แผนไม่มี W00 manifest, reliability corpus, whole-chain | ไม่ |
| RM-10 | ควรแก้ | ช่องว่าง | คู่มือถูก pin hash กับชุดคำตอบ LINE และ LINE ยังบอกให้ "บันทึกด้วยมือ" | ใช่ |
| RM-11 | ควรแก้ | ช่องว่าง | รายการทางเข้าใน §9 ไม่ครบ | ไม่ |
| RM-12 | ควรแก้ | ข้อผิดพลาดในสเปก | สัญญา session กว้างเกินจำเป็น และ "ไม่รู้ค่า = ปิด" เสี่ยงใช้งานไม่ได้ | ใช่ |
| RM-13 | ควรแก้ | ช่องว่าง | "admission" ตัดสินที่ไหน เก็บที่ไหน ยังไม่ชัด | ไม่ |
| RM-14 | ควรแก้ | ช่องว่าง | บนมือถือ หน้าเว็บโหลดใหม่เอง ทำให้ฟอร์มที่กรอกค้างหายและกลับเข้าไม่ได้ | ใช่ |
| RM-15 | ควรแก้ | ช่องว่าง | ข้อความฝั่งผู้ดูแลยังไม่บอกสิ่งที่สวิตช์ทำจริง และไม่มีจุดประสงค์ | ใช่ |
| RM-16 | ควรแก้ | ช่องว่าง | ปิดพร้อม `expenses.upload` แล้วพนักงานไม่มีทางสร้างรายจ่ายบนเว็บ | ใช่ |
| RM-17 | ควรแก้ | ผลกระทบ | พึ่งกติกา "ไม่มีแถว = เปิด" ที่มีแผนจะถอดออก | ไม่ |
| RM-18 | ควรแก้ | ข้อผิดพลาดในสเปก | ข้อความเรื่อง rollback ใน §15 ไม่ตรง | ไม่ |
| RM-19 | ควรแก้ | ช่องว่าง | แผน: ลำดับ, ไฟล์ที่ขาด, test ที่เขียวทั้งที่ผิด, ไฟล์ที่ถูก pin | ไม่ |
| RM-20 | ควรแก้ | บั๊กในระบบปัจจุบัน | F02 จริง แต่กระทบเฉพาะบทบาทที่สร้างจากเทมเพลตการเงิน | ใช่ |
| RM-21 | ควรแก้ | ช่องว่าง | คุณภาพหลักฐาน: harness รันจาก repo ไม่ได้ และยืนยันเป้าหมาย v1 | ไม่ |
| RM-22 | เล็กน้อย | ข้อผิดพลาดในสเปก | ข้อขัดกันภายในเอกสาร | ไม่ |
| RM-23 | เล็กน้อย | ช่องว่าง | `toggleSubmenu` เปิด parent ให้เอง ขัดกับ §5.1 | ไม่ |
| RM-24 | เล็กน้อย | ช่องว่าง | route ซ้ำ, `prefetch={false}`, ไฮไลต์เมนู | ไม่ |
| RM-25 | เล็กน้อย | ข้อผิดพลาดในสเปก | memory `manual-expense-multi-item` มี "Next" ค้างที่ไม่จริงแล้ว | ไม่ |

### 2.2 รายละเอียด — ต้องแก้ก่อนเริ่มทำ

#### RM-01 ฐานโค้ดที่ตรวจเป็น branch เก่าที่แยกจาก develop

- **หลักฐาน**: audit บรรทัด 3 และ QA บรรทัด 3 ระบุ baseline `4a5817b42` "พร้อม existing dirty source" · `git merge-base --is-ancestor 4a5817b42 ae13970b0` ได้ผลว่าไม่ใช่บรรพบุรุษ · `git rev-list --count 4a5817b42..ae13970b0` = 842 · นำ `docs/evidence/manual-expense-web-entry-flag-2026-10-01/source-before.json` (3,728 ไฟล์) มาเทียบกับ `ae13970b0`: ตรง 2,852, ต่าง 596, ไม่มีใน repo 280 (ส่วนใหญ่เป็นไฟล์ build และ `.DS_Store`) · ไฟล์หลักที่เอกสารอ้าง 10 จาก 13 ไฟล์ต่างกัน เช่น `packages/contracts/src/feature-entitlements.ts` (ตอนตรวจมี 60 key ตอนนี้ 62), `apps/api/src/modules/billing/application/billing-feature-entitlements.ts`, `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.ts`, `apps/web/src/features/system-partners/PartnerDetailPage.tsx` (เปลี่ยน 986 บรรทัด), `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts`
- **สิ่งที่จะผิดพลาด**: ผู้ลงมือทำเชื่อสถานะ "READY FOR IMPLEMENTATION" แล้วทำตาม audit ที่ไม่ตรงกับโค้ดจริง สามเรื่องที่ audit มองไม่เห็นเพราะเกิดหลัง baseline คือ (ก) F03 ถูกแก้แล้ว (RM-02) (ข) billing มีกฎรูปชุดแถวแบบใหม่และตัวอย่างการเพิ่ม key สองตัวของ WHT (RM-03) (ค) command สิทธิ์เรียก `invalidateLineConversationState` (เพิ่มเมื่อ 2026-09-27, RM-06) ข้อความ "SHA-256 verification of 3,728 files: zero changed" ใน memory พิสูจน์เพียงว่าการทดสอบไม่ได้แก้ working tree ของผู้ทดสอบ ไม่ได้พิสูจน์ว่าโค้ดที่ทดสอบคือโค้ดที่จะทำ
- **ข้อเสนอแก้**:
  - spec บรรทัด 5 แทนที่ด้วย: `Status: **NEEDS REVISION — ข้อค้นพบปัจจุบันตรวจบน 4a5817b42 ซึ่งไม่ใช่บรรพบุรุษของ develop; ต้องตรวจซ้ำตาม review 2026-10-01 ก่อนเริ่ม implement**`
  - audit เพิ่มใต้บรรทัด 3: `ข้อจำกัด: baseline นี้แยกจาก origin/develop (ห่าง 842 commit ณ ae13970b0) ทุกแถวในหัวข้อ 2–3 ต้องตรวจซ้ำที่ commit ที่จะ implement; F03 ไม่เป็นจริงแล้วบน develop`
  - plan P0 เพิ่ม checkbox: `- [ ] เริ่มจาก origin/develop ล่าสุด แล้วตรวจ F01–F09 ซ้ำที่ SHA นั้นทีละข้อ ถ้าข้อใดไม่ตรงให้แก้ audit และ spec ก่อนเขียนโค้ด`
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-02 F03 แก้ไปแล้ว แต่สเปก §12 เสนอเปลี่ยนสูตร key อีกครั้ง

- **หลักฐาน**: spec บรรทัด 64 (F03), 70 (F09), 270–292 (§12), AC12, AC13 · plan P4 บรรทัด 93–95 และ §5 แถว "LINE real create" · audit บรรทัด 34–35, 119, 141 · QA E09 · `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts:34-40` (`lineDraftIdempotencyKey` คืน `line-draft-<id>` พร้อมหมายเหตุ "NAT12 (2026-09-29)"), `:212` (จุดเรียก) · `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts:46-57` (test ยืนยัน key ผ่าน `PAYMENT_IDEMPOTENCY_KEY_PATTERN`) · commit `6fddca795` วันที่ 2026-09-29 21:39 · เนื้อหาเดียวกันอยู่ใน `origin/main`, `origin/develop`, `e52c151a`, `908e7aab` · รันจริง: `pnpm --filter @watchdog-bms/api exec tsx --test --test-name-pattern=NAT12 …/expense-document.use-case.spec.ts` ผ่าน
- **สิ่งที่จะผิดพลาด**: (ก) คนทดสอบถูกสั่งให้ "บันทึก 400 ตามที่เกิดจริง" (plan บรรทัด 94) แต่ระบบจริงสร้าง draft สำเร็จ จึงสับสนหรือรายงานผิด (ข) มีคนเปิดงาน "follow-up B" ตาม §12 แล้วเปลี่ยนสูตรเป็น SHA-256 64 ตัว ทำให้ key ไม่ตรงกับ draft ที่ production สร้างด้วย `line-draft-<eventId>` ไปแล้ว การ retry ของ event เดิมที่ชน orphan boundary จะสร้างรายการซ้ำได้ §12.2 เตรียมรับเฉพาะ key รูป `line-draft:` ซึ่งไม่เคยบันทึกลงฐานข้อมูลได้เลยเพราะไม่ผ่าน validator
- **ข้อเสนอแก้**:
  - spec §3 แถว F03 แทนที่ด้วย: `| F03 | ปิดแล้ว ไม่ใช่งานค้าง | แก้ใน 6fddca795 (2026-09-29): lineDraftIdempotencyKey() คืน line-draft-<id> ที่ผ่าน PAYMENT_IDEMPOTENCY_KEY_PATTERN และอยู่ใน main/develop แล้ว | ไม่มีงานในขอบเขตนี้ ห้ามเปลี่ยนสูตร key อีก |`
  - spec §3 แถว F09 แทนที่ช่อง Target ด้วย: `unit test ยืนยันรูป key แล้ว (expense-document.use-case.spec.ts) ยังไม่มี integration แบบ compose จริง เพิ่มได้เป็นงานแยกโดยยืนยัน key ปัจจุบัน`
  - spec §12 แทนที่ทั้งหัวข้อด้วย: `## 12. LINE draft idempotency — ปิดแล้ว` ตามด้วย `บั๊กนี้แก้แล้วใน 6fddca795 ก่อนเอกสารนี้ถูก merge ข้อเสนอ SHA-256 64 ตัวและ compatibility lookup ถูกถอน สูตรปัจจุบัน (line-draft-<event id> หรือ hash 53 ตัวเมื่อ id ยาวเกิน) คือสัญญาที่ใช้งานอยู่ ห้ามเปลี่ยนในงานสวิตช์`
  - spec AC12 แทนที่ด้วย: `key ใหม่ ON/OFF ไม่เปลี่ยน LINE capture permission/path/result; LINE text note สร้าง draft สำเร็จเท่ากันทั้งสองสถานะ`
  - spec AC13 ตัดประโยค `LINE F03 retry evidence แยกจากงานสวิตช์`
  - plan P4 บรรทัด 93 และ 95 ตัดการอ้าง F03 ออก (คง F02 ไว้) และลบบรรทัด 94; §5 แถว LINE แทนที่ Expected ด้วย: `NEW key ไม่เปลี่ยนผล; สร้างสำเร็จและ replay คืนรายการเดิมทั้ง ON/OFF (12)`
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-03 เพิ่ม key เข้า catalog แล้วร้านเดิมซื้อหรืออัปเกรดแพ็กเกจไม่ได้

- **หลักฐาน**: spec §5.1 บรรทัด 100–108, §10 ข้อ 5, §15 บรรทัด 323 ("เพิ่ม catalog key + additive session field + UI admission เท่านั้น") · plan §2 แถว "Regression only by default … billing" · `apps/api/src/modules/billing/application/billing-feature-entitlements.ts:14` (`CANONICAL` มาจาก `ALL_FEATURE_ENTITLEMENT_KEYS`), `:51` (`completeCatalog` ต้องตรงทุกแถว), `:54-57` (`previousCatalog` ฝังเลข `CANONICAL.length === 62` และ 60), `:58-59` (ไม่เข้ารูปใดเลย → `review()`), `:113` (`pinned.rows.length !== CANONICAL.length` → `review()`) · `apps/api/src/modules/billing/application/billing.service.ts:506-509` (quote แบบ pin เรียกโดยไม่มี catch) · `apps/api/src/modules/billing/application/billing-reconciler.service.ts:588-611` (ได้ `BILLING_ENTITLEMENT_REVIEW_REQUIRED` → `applyStatus: 'HELD'` และ issue `PAID_HELD`) · `apps/api/src/modules/billing/application/billing-plan-menus.ts:105-109,121-132` (ย้ายเมนูตอนเปลี่ยนแพ็กเกจ → `BLOCKED`) · `infra/kamal/release.py:956-957` (release รัน normalizer แบบ `--dry-run` เท่านั้น จึงไม่มีใครเติมแถวให้)
- **รันจริง**: เพิ่ม leaf ใน catalog ในหน่วยความจำแล้วเรียก `billingFeaturePlan` ของจริง กับร้าน EXPLICIT 62 แถว ได้ `BILLING_ENTITLEMENT_REVIEW_REQUIRED` ข้อความ "ข้อมูลสิทธิ์เมนูเดิมยังไม่พร้อม กรุณาติดต่อทีมงานก่อนชำระเงิน"
- **สิ่งที่จะผิดพลาด**: วัน deploy ร้านที่มีแถวสิทธิ์เก็บอยู่ (60 หรือ 62 แถว คือทุกร้านที่ผ่าน normalization, onboarding หรือเคยซื้อแพ็กเกจ) ขอใบเสนอราคาแบบ pin ไม่ได้ (ซื้อครั้งแรก, ซื้อใหม่หลังหมดอายุ, ดีล, อัปเกรดเต็มแพ็กเกจ — ตาม `packageMenuPurchaseSource` ใน `billing-purchase-source.ts:40-41`) ลูกค้าที่เปิด checkout ไว้ก่อน deploy แล้วจ่ายหลัง deploy เงินเข้าแต่ใบแจ้งหนี้ถูกพัก ทีมต้องแก้ทีละราย และการอัปเกรดหรือเปลี่ยนแพ็กเกจค้างที่ `PLAN_MENU_MOVE_REVIEW` (การต่ออายุแพ็กเกจเดิมตามรอบไม่เรียกส่วนนี้ จึงไม่ได้รับผล) · กับดักซ้อน: ถ้าผู้ทำ "แก้" โดยเปลี่ยนเลข 62/60 เป็น 63/61 ร้าน 60 แถวรุ่นก่อน WHT จะถูกบล็อกแทน · test เดิมจับไม่ได้: จำลองแล้ว `billing-feature-entitlements.spec.ts` แดงเพียง 1 ข้อที่ pin เลข 60 ส่วน fixture ข้ออื่นสร้างแถวจาก catalog ใหม่จึงเขียว
- **ข้อเสนอแก้**: spec §10 เพิ่มข้อ 8 (ใช้เมื่อเลือกแบบ A ใน RM-08): `8. Billing ต้องรับชุดแถวของร้านเดิมที่ยังไม่มีแถว key ใหม่ billingFeaturePlan ตรวจรูปชุดแถวจาก key เชิงพาณิชย์เท่านั้น (catalog ลบ key ที่ permissionKeys ว่าง) รูปที่ต้องผ่านคือ 60 แถวรุ่นก่อน WHT และ 62 แถวรุ่นปัจจุบัน ทั้งกรณีมีและไม่มีแถว key ใหม่ applyBillingFeaturePlan ต้อง apply plan ที่ pin ไว้ก่อน deploy (62 แถว) ได้ ห้ามแก้ด้วยการเปลี่ยนเลข 62/60 เป็น 63/61 Test บังคับ: (ก) ร้าน EXPLICIT 62 แถว + catalog ใหม่ quote และ apply ผ่าน (ข) ร้าน 60 แถวผ่าน (ค) plan ที่ pin ก่อนเพิ่ม key apply ผ่านโดย invoice ไม่ HELD` และ plan §2 ย้าย billing ออกจากแถว "Regression only" ไปเป็นแถวที่ต้องแก้ พร้อมไฟล์ `billing-feature-entitlements.ts` กับ spec ของมัน
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-04 ค่าเริ่มต้นถูกเขียนเป็นปิดโดย onboarding, billing, preset และดีล

- **หลักฐาน**: spec §5.1 บรรทัด 107 ("Onboarding/package materialization ต้องไม่เผลอเขียน explicit false") และ plan P3 บรรทัด 82–83 บอกเจตนาแต่ไม่บอกวิธี และไม่มีไฟล์เหล่านี้ใน inventory · `packages/contracts/src/menu-entitlements.ts:432-450` (`STARTER_FEATURE_KEYS` เขียนตายตัว), `:496-501` (`TIER_FEATURE_PRESETS` ทุกแพ็กเกจใช้ starter), `:504-508` (`SALES_DEAL_ALLOWED_FEATURE_KEYS`) · `apps/api/src/modules/system-onboarding/application/use-cases/create-company-onboarding.use-case.ts:580-591` (ค่าเริ่มต้น `modulePackage ?? 'starter'` → `enabled: starterKeys.has(featureKey)`) · `apps/api/src/modules/billing/application/billing-feature-entitlements.ts:68-70,96-100` (ค่าเป้าหมายมาจากรายการแพ็กเกจ, key ที่เปิดอยู่แต่ไม่อยู่ในรายการเข้า `impact.removed`) · `apps/web/src/features/system-partners/system-partners.logic.ts:274-288` (`applyPreset` ไม่อ่าน state) · `apps/web/src/features/billing/BillingPage.tsx:717-719` (หน้าชำระเงินแสดง `featureImpact.removed` ให้ลูกค้าเห็นว่า "เมนูต่อไปนี้จะหยุดใช้")
- **รันจริง**: (ก) ร้าน legacy ไม่มีแถว ซื้อแพ็กเกจครั้งแรก → plan เขียน `expenses.manual.web_entry=false` และแสดงใน `impact.removed` ด้วยป้าย "ค่าใช้จ่าย+ใบเสร็จ · แสดงทางเข้าบันทึกด้วยมือบนเว็บ" (ข) ร้าน 63 แถวที่ key ใหม่เป็น true แต่ไม่มี transition ของผู้ดูแล → ถูกเขียน false (ค) มี transition ของผู้ดูแล → คงค่าเดิมผ่าน `adminOverrideKeys` (ง) `applyPreset('starter'|'standard')` คืน false เสมอไม่ว่าเดิมเป็นค่าใด (จ) `create-company-onboarding.spec.ts` 42 ข้อยังเขียวหลังเพิ่ม key ทั้งที่แถวใหม่เป็น false
- **สิ่งที่จะผิดพลาด**: ร้านที่สมัครใหม่หลัง deploy ไม่เห็นเมนูบันทึกด้วยมือทั้งที่ไม่มีใครสั่งปิด ร้านเดิมที่ซื้อแพ็กเกจครั้งแรก ซื้อใหม่หลังหมดอายุ หรืออัปเกรด (เมื่อแก้ RM-03 แล้ว) เห็นเมนูหายเองและเห็นรายการ "สิ่งที่จะถูกปิด" บนหน้าชำระเงิน ดีลเก่าที่ snapshot ตรึงไว้แล้วไม่มี key ใหม่จึงปิดเมนูทุกครั้งที่ apply
- **ข้อเสนอแก้**: spec §5.1 แทนที่บรรทัด 107 ด้วย: `- key ที่ permissionKeys ว่างไม่ใช่สิทธิ์เชิงพาณิชย์ ผู้เขียนแถวทุกตัว ได้แก่ CreateCompanyOnboardingUseCase (ทั้งทาง starter และทาง default), billingFeaturePlan/applyBillingFeaturePlan/movePlanMenus, applyPreset และ snapshot ของดีล ต้องไม่คำนวณค่าจากรายการแพ็กเกจ ค่า = ค่าที่เก็บอยู่ ถ้ายังไม่มีแถว = เปิด key นี้ไม่อยู่ใน STARTER_FEATURE_KEYS, TIER_FEATURE_PRESETS, SALES_DEAL_ALLOWED_FEATURE_KEYS และไม่ปรากฏใน featureImpact.added/removed Test บังคับ: onboarding ทาง starter ได้แถว key ใหม่ enabled=true; ซื้อแพ็กเกจและ apply ดีลที่ snapshot ไม่มี key แล้วค่าเดิมคงอยู่ทั้งกรณี true, false และไม่มีแถว` และ plan §2 เพิ่มไฟล์ `packages/contracts/src/menu-entitlements.ts`, `create-company-onboarding.use-case.ts`, `billing-feature-entitlements.ts`
- **เจ้าของต้องตัดสิน**: ใช่ — "ร้านที่เปิดใหม่ และร้านที่ซื้อหรืออัปเกรดแพ็กเกจ ควรเห็นเมนูบันทึกด้วยมือเป็นค่าเริ่มต้นไหม และการซื้อแพ็กเกจควรเปลี่ยนค่าที่ผู้ดูแลตั้งไว้หรือไม่" คำตอบที่แนะนำ: ร้านใหม่เห็นเมนูเป็นค่าเริ่มต้น และการซื้อ อัปเกรด หรือซื้อดีลไม่เปลี่ยนค่านี้เลย

#### RM-05 ผู้ดูแลปิดสวิตช์ให้ร้านเดิมไม่ได้

- **หลักฐาน**: spec §5.1 บรรทัด 105 ("missing new row ให้ inherit ON"), บรรทัด 108 ("การ bootstrap row เมื่อ admin บันทึกครั้งแรก") และ §8 ไม่กล่าวถึงกลไกนี้ · `apps/api/src/modules/system-partner-management/application/use-cases/get-partner-detail.use-case.ts:165-178` (`featureEntitlements` และ `canDisable` สร้างจากแถวที่เก็บอยู่เท่านั้น) · `apps/web/src/features/system-partners/system-partners.logic.ts:341-362` (`disableBlockForChange`: key ที่ไม่มี readiness ถือว่าปิดไม่ได้) · `apps/web/src/features/system-partners/PartnerDetailPage.tsx:918-923` (`updatePending` ปฏิเสธพร้อม toast)
- **รันจริง**: จำลองร้านเดิม 62 แถว กดปิด leaf ผ่าน `toggleSubmenu` แล้ว `disableBlockForChange` คืน `{ reason: 'ข้อมูลสิทธิ์ของฟีเจอร์นี้ยังไม่ครบ จึงยังปิดไม่ได้', featureKeys: ['expenses.manual.web_entry'] }` เมื่อมีแถวอยู่แล้วจึงไม่ถูกบล็อก
- **สิ่งที่จะผิดพลาด**: ผู้ดูแลเปิดหน้าร้านเดิม เห็นสวิตช์ใหม่เป็นเปิด กดปิดแล้วขึ้นข้อความ error ทุกครั้ง ปิดได้เฉพาะร้านที่เกิดหลัง deploy งานนี้จึงไม่ตอบโจทย์เจ้าของ
- **ข้อเสนอแก้**: spec §8 เพิ่ม bullet: `- ร้านเดิมที่ยังไม่มีแถว key ใหม่ต้องปิดได้จากหน้าจอ เลือกทางใดทางหนึ่ง: (ก) disableBlockForChange ถือว่า key ที่ permissionKeys ว่างและไม่มีแถวปิดได้ หรือ (ข) GET partner detail คืนรายการของ key นี้แม้ไม่มีแถว (enabled = ค่าที่มีผลจริง, canDisable = true) เฉพาะร้านที่มีแถวอื่นอยู่แล้ว ห้ามเติมให้ร้าน legacy ศูนย์แถว เพราะหน้าเว็บใช้ entitlements.length === 0 เป็นสัญญาณ fail-open Test: server คืน 62 แถว → กดปิด leaf ไม่ถูกบล็อก → บันทึกแล้วเกิดแถว false หนึ่งแถว` และ plan §2 เพิ่มไฟล์ `get-partner-detail.use-case.ts`
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-06 การกดสวิตช์รบกวน LINE ของทั้งร้าน

- **หลักฐาน**: spec §1 ข้อ 3, §13 แถว LINE, AC12, AC14 ("ไม่เปลี่ยน LINE") และ §5.1 ("ใช้ CompanyFeatureEntitlement และ command เดิม") · `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.ts:295` (`wasOn`), `:420,465,482-497` (ON→OFF จริง → `DISABLE_REQUESTED` และ `RunoffSnapshot`), `:566-568` (เรียก `invalidateLineConversationState` เมื่อค่าที่มีผลเปลี่ยน) · `apps/api/src/modules/line-ai/application/line-conversation-context.service.ts:20-32` (เพิ่ม `lifecycleEpoch`, ล้าง `taskStateJson`, ลบ `aiTurn`, ทำ `lineIntakePendingMedia` ที่ PENDING ให้ EXPIRED, ทำ `lineDeliveryPlan` ที่ READY/UNKNOWN/WAITING_CONTINUATION ให้ REFUSED ด้วยเหตุผล `AUTH_CHANGED`) · `apps/api/src/modules/line-ai/application/line-delivery-access.ts:6-19` และ `apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts:343` (fingerprint รวมรายการ key ที่เปิดอยู่ ต่างกันแล้วไม่ส่งคำตอบ) · บรรทัด 566–568 เพิ่มเข้ามา 2026-09-27 หลัง baseline ของ audit
- **รันจริง**: เรียก `SetPartnerFeaturesUseCase` ของจริงกับ Prisma จำลองที่บันทึกการเรียก สลับเฉพาะ `expenses.manual.web_entry` เป็น false ในร้าน 62 แถว ผลคือ command สำเร็จ, transition เป็น `DISABLE_REQUESTED`, สร้าง `RunoffSnapshot` 1 รายการ และเรียกครบทั้ง `aiConversation.updateMany`, `aiTurn.deleteMany`, `lineIntakePendingMedia.updateMany`, `lineDeliveryPlan.updateMany`
- **สิ่งที่จะผิดพลาด**: ผู้ดูแลกดปิดทางเข้าเว็บตอน 10:00 พนักงานที่เพิ่งส่งรูปเข้า LINE แล้วระบบถามกลับว่ารูปนี้คืออะไร คำตอบของเขาใช้ไม่ได้เพราะรูปที่รอคำตอบถูกทำให้หมดอายุ คำตอบของผู้ช่วยที่รอส่งถูกปฏิเสธ บทสนทนาที่กำลังตอบคำถามร่างรายจ่ายถูกล้าง ทั้งที่สวิตช์เป็นเรื่องหน้าจอเว็บ
- **ข้อเสนอแก้**: spec §14 เพิ่ม bullet: `- การสลับ key ที่ permissionKeys ว่างไม่ใช่การเปลี่ยนสิทธิ์ SetPartnerFeaturesUseCase ต้องไม่เรียก invalidateLineConversationState ไม่สร้าง RunoffSnapshot และบันทึก transition เป็น ENABLE หรือ OFF ตรง ๆ (ไม่ใช้ DISABLE_REQUESTED) รายการ entitledFeatureKeys ที่ส่งให้ LINE, AI Gateway และ lineDeliveryAccessFingerprint ต้องไม่รวม key นี้ Test: มี LINE turn ค้าง, pending media และ delivery plan สถานะ READY → สลับ key → ทั้งสามอย่างคงอยู่และคำตอบถูกส่ง` และ spec AC12 เพิ่มท้าย: `รวมถึงบทสนทนา งานรูปค้าง และคำตอบที่รอส่งของ LINE ต้องไม่ถูกยกเลิกเพราะการสลับ key`
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-07 การกดสวิตช์ทำให้ใบแจ้งหนี้ที่ลูกค้าจ่ายแล้วถูกพัก

- **หลักฐาน**: spec §10 ข้อ 7 และ §14 (ใช้ `commandId`, `expectedSetVersion`, CAS เดิม) · `apps/api/src/modules/billing/application/billing-feature-entitlements.ts:101-103` (`sourceHash` รวม `setVersion` และ `lastSeq` ของทุกแถว), `:117-118,126` (ตรวจซ้ำตอน apply) · `apps/api/src/modules/billing/application/billing-reconciler.service.ts:588-611` · หมายเหตุเดิมใน `apps/api/src/modules/billing/application/billing-plan-menus.ts:5-8` ยอมรับว่าการแก้สิทธิ์โดยผู้ดูแลระหว่างทางทำให้เงินที่จ่ายแล้วถูกพัก
- **รันจริง**: pin plan ที่ `setVersion=5` แล้วจำลองผู้ดูแลสลับ key ใหม่ (`setVersion=6`, `lastSeq+1`) → `sourceHash` เปลี่ยน → reconciler จะตั้ง `featureReady=false` และ invoice เป็น `HELD`
- **สิ่งที่จะผิดพลาด**: ฝ่ายขายปิดดีลกับร้าน ลูกค้าเปิดหน้าชำระเงิน ผู้ดูแลเข้าไปตั้งค่าร้านและกดซ่อนเมนูบันทึกด้วยมือในช่วงเดียวกัน ลูกค้าจ่ายเงินแล้วแพ็กเกจไม่ถูกเปิดให้ ต้องให้ทีมตรวจด้วยมือ ความเสี่ยงนี้มีอยู่แล้วกับการแก้สิทธิ์ทุกชนิด แต่สวิตช์ใหม่ดูเป็นเรื่องหน้าจอ ผู้ดูแลจึงมีโอกาสกดในจังหวะนี้มากกว่า
- **ข้อเสนอแก้**: ถ้าเลือกแบบ B ใน RM-08 ปัญหานี้หายไปเอง ถ้าเลือกแบบ A ให้เพิ่มใน spec §14: `- สวิตช์นี้ใช้ CAS ร่วมกับสิทธิ์แพ็กเกจ การสลับจึงทำให้ plan ที่ billing pin ไว้ใช้ไม่ได้ command ต้องปฏิเสธเมื่อร้านมี BillingAttempt ที่ยัง active และมี featurePlan pin อยู่ ด้วยข้อความ "ร้านนี้กำลังชำระค่าแพ็กเกจ กรุณารอให้เสร็จก่อน" Test: มี attempt ที่ pin อยู่ → สลับ key ถูกปฏิเสธและ invoice ไม่ HELD`
- **เจ้าของต้องตัดสิน**: ไม่ (ผูกกับ RM-08)

#### RM-08 ต้องเลือกที่เก็บสวิตช์ และบันทึกข้อยกเว้นของกฎ "No nav-only gating"

- **หลักฐาน**: spec §5.1 ("Smallest fit: เพิ่ม leaf definition ใน FEATURE_CATALOG") · `docs/plans/feature-entitlement-submenu-plan.md:20` กฎข้อ 4 "One chokepoint … No nav-only gating" ซึ่ง key ใหม่ขัดโดยตรง · plan บรรทัด 165 เลื่อนการปรับเอกสารหลักไป "เมื่อ implementation เสร็จ" · ตัวอย่างสวิตช์รายร้านที่ผู้ดูแลตั้งและไม่ใช่สิทธิ์แพ็กเกจมีอยู่แล้ว: `CompanyAiConfiguration.ocrEnabled` (`apps/api/prisma/schema.prisma:4075`) ตั้งผ่าน `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-ocr-config.use-case.ts:43-99` มี CAS ของตัวเอง (`ocrConfigVersion`) และ audit
- **สิ่งที่จะผิดพลาด**: ในโค้ดปัจจุบัน key ใน catalog ถูกปฏิบัติเป็น "สิทธิ์" ทุกที่ ได้แก่ ระบบชำระเงิน (RM-03, RM-04, RM-07), LINE (RM-06), normalizer (RM-17), ดีล, W00 manifest และ reliability corpus (RM-09) ข้อความ "smallest fit" จึงไม่จริง ถ้าไม่ตัดสินก่อน ผู้ทำจะพบเรื่องเหล่านี้ทีละเรื่องระหว่างทาง
- **ข้อเสนอแก้**: เพิ่มหัวข้อใหม่ใน spec ก่อน §5 ชื่อ `## 4A. การตัดสินใจเรื่องที่เก็บสวิตช์ (ต้องปิดก่อนเริ่ม)` โดยเลือกหนึ่งแบบ
  - **แบบ A — เป็น key ใน catalog ตามสเปกเดิม** ต้องเพิ่มกฎใน RM-03, RM-04, RM-05, RM-06, RM-07, RM-09, RM-17 ทั้งหมดเข้า spec และ plan และบันทึกข้อยกเว้นของกฎข้อ 4 ใน `feature-entitlement-submenu-plan.md` ก่อนเขียนโค้ด ไม่ใช่หลังเสร็จ
  - **แบบ B — เป็นค่าตั้งหน้าจอของร้าน แยกจากสิทธิ์แพ็กเกจ** เก็บ boolean ค่าเริ่มต้น true แบบเดียวกับ `ocrEnabled` ตั้งผ่าน command เล็กของตัวเองพร้อม audit แสดงใต้แถว "บันทึกด้วยมือ" ในหน้าผู้ดูแลเหมือนเดิม `/auth/me` ส่ง boolean ตัวเดียว ไม่แตะ `FEATURE_CATALOG`, billing, LINE, normalizer, W00 manifest ข้อแลกเปลี่ยนคือมี migration แบบ additive หนึ่งรายการ ซึ่งต้องผ่านขั้นตอน migration ของ production
  - ข้อความพร้อมวางถ้าเลือกแบบ B แทน §5.1 ทั้งหัวข้อ: `สวิตช์นี้ไม่ใช่ entitlement key เก็บเป็นค่าตั้งรายร้าน manualExpenseWebEntryEnabled (ค่าเริ่มต้น true) ผู้ดูแลระบบตั้งผ่าน command เฉพาะที่มี CAS ของตัวเองและ audit ไม่ bump CompanyEntitlementSet.setVersion ไม่เกี่ยวกับแพ็กเกจ ดีล preset หรือ normalization หน้าผู้ดูแลแสดงใต้แถว "บันทึกด้วยมือ" และปิดการแก้ไขเมื่อ expenses หรือ expenses.manual ปิดอยู่`
- **เจ้าของต้องตัดสิน**: ใช่ — "สวิตช์นี้ควรเป็นส่วนหนึ่งของแพ็กเกจที่ขาย หรือเป็นแค่การตั้งค่าหน้าจอของร้าน" คำตอบที่แนะนำ: เป็นการตั้งค่าหน้าจอของร้าน แยกจากแพ็กเกจ (แบบ B) เพราะไม่กระทบการชำระเงินและ LINE และผู้ดูแลยังเห็นสวิตช์อยู่ที่เดิมใต้ "บันทึกด้วยมือ"

### 2.3 รายละเอียด — ควรแก้

#### RM-09 แผนไม่มี W00 manifest, reliability corpus และ whole-chain

- **หลักฐาน**: plan §2–§4 ไม่กล่าวถึง · `apps/api/src/modules/line-ai/line-ai-capability-manifest.ts:218-221` (hash ไฟล์ `feature-entitlements.ts` และ `menu-entitlements.ts`), `:613` (`featureEntitlementKeys` ทั้งรายการ) · `docs/research/mangmee-ai-capability-manifest-2026-09-27.json` มี 62 key · `scripts/line-ai-reliability-corpus.ts:343`, `scripts/line-ai-reliability-corpus.spec.ts:110-116` · `scripts/line-ai-whole-chain-acceptance.catalog.mjs:347,415`
- **รันจริง** (เพิ่ม leaf ในหน่วยความจำแล้วรัน spec เดิม): `line-ai-capability-manifest.spec.ts` แดง 1 ข้อ, `scripts/line-ai-reliability-corpus.spec.ts` แดง 1 ข้อ, `apps/web/…/system-partners.logic.spec.ts` แดง 2 ข้อ (รายการ submenu ที่ pin ไว้), `billing-feature-entitlements.spec.ts` แดง 1 ข้อ
- **สิ่งที่จะผิดพลาด**: PR แดงที่ CI ในจุดที่แผนไม่ได้บอก ผู้ทำแก้เฉพาะหน้าโดยไม่ regenerate ตามขั้นตอน
- **ข้อเสนอแก้**: plan P1 เพิ่ม checkbox (ใช้เมื่อเลือกแบบ A): `- [ ] หลังแก้ feature-entitlements.ts หรือ menu-entitlements.ts: regenerate W00 manifest ด้วย UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 กับ line-ai-capability-manifest.spec.ts, regenerate corpus ด้วย scripts/line-ai-reliability-corpus.ts --write แล้วรัน node scripts/run-line-ai-whole-chain-acceptance.mjs ก่อน push` · หมายเหตุเรื่อง run-off matrix: `docs/specs/feature-entitlement-runoff-matrix.json` เป็นระดับ family งานนี้ไม่ต้องเพิ่มแถว ถ้ามีคนเพิ่มแถว surface ใหม่ ต้องแก้ `RUNOFF_MATRIX_FEATURES` ใน `apps/api/src/modules/feature-launch/domain/runoff-matrix.catalog.ts` ให้ตรง เพราะ `runoff-matrix.catalog.spec.ts:32-47` เทียบยอดรวมกับไฟล์ JSON
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-10 คู่มือถูก pin hash กับชุดคำตอบ LINE และ LINE ยังบอกให้ "บันทึกด้วยมือ"

- **หลักฐาน**: spec §9 แถว "User guide" และ plan §2 ระบุให้แก้ `expenses-guide.content.ts` · `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts:5` (hash ของไฟล์คู่มือ `73f50c33…` ซึ่งตรงกับไฟล์ปัจจุบัน), `:38-39` (การ์ด `expense.start`: "…นำใบเสร็จเข้าระบบหรือบันทึกด้วยมือ…"), ช่วงมีผลถึง `2026-12-27` · `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts:34` (ตรวจ hash ไฟล์) · spec §13 แถว LINE gateway ("ไม่เปลี่ยน prompts/tools") · `apps/web/src/features/user-guide/expenses-guide.content.ts:36,53,92,215,228-262` (ข้อความและหัวข้อ "บันทึกด้วยมือ" ทั้งหัวข้อ ไม่ใช่แค่ลิงก์บรรทัด 240)
- **สิ่งที่จะผิดพลาด**: (ก) แก้ไฟล์คู่มือเพื่อซ่อนลิงก์แล้ว `approved-knowledge.spec.ts` แดง ต้อง hash และทบทวนชุดคำตอบใหม่ซึ่งแผนไม่ได้เผื่อ (ข) ร้านที่ปิดทางเข้า พนักงานถาม LINE ว่าเริ่มลงค่าใช้จ่ายอย่างไร ได้คำตอบให้ "บันทึกด้วยมือ" แล้วหาเมนูไม่เจอ (ค) คู่มือบนเว็บยังมีหัวข้อสอนกรอกฟอร์มห้าขั้นของหน้าที่เข้าไม่ได้
- **ข้อเสนอแก้**: spec §9 แถว "User guide" แทนที่ด้วย: `เมื่อ OFF ซ่อนลิงก์ "เปิดหน้าบันทึกด้วยมือ" และหัวข้อ id manual ทั้งหัวข้อ รวมแถว "บันทึกด้วยมือ" ในตารางเมนูย่อย; buildExpensesGuide รับค่าทางเข้าเป็น argument ใหม่ ไม่อ่านจาก permissions; การแก้ไฟล์นี้ต้องอัปเดต hash ใน approved-product-help.ts และรัน approved-knowledge.spec.ts` และ spec §13 เพิ่มแถว: `| ชุดคำตอบ LINE (approved-product-help.ts) | การ์ด expense.start ยังกล่าวถึงบันทึกด้วยมือ; รอบนี้ไม่แก้เนื้อหา บันทึกเป็นข้อจำกัด และปรับถ้อยคำในรอบทบทวนชุดคำตอบครั้งถัดไป |`
- **เจ้าของต้องตัดสิน**: ใช่ — "เมื่อปิดสวิตช์ คู่มือบนเว็บและคำตอบของน้องมั่งมีใน LINE ที่พูดถึงบันทึกด้วยมือ ควรซ่อนหรือปรับด้วยไหม" คำตอบที่แนะนำ: ซ่อนหัวข้อและปุ่มในคู่มือบนเว็บ ส่วนข้อความใน LINE ปล่อยไว้รอบนี้และปรับถ้อยคำตอนทบทวนชุดคำตอบครั้งถัดไป

#### RM-11 รายการทางเข้าใน §9 ไม่ครบ

- **หลักฐาน**: รายการเต็มอยู่หัวข้อ 3 จุดที่สเปกไม่ได้ระบุคือ E10–E12, E14, E21–E24, E26
- **สิ่งที่จะผิดพลาด**: AC04 ผ่านตามรายการในสเปก แต่ผู้ใช้ยังถูกบอกให้ไปหน้าที่เข้าไม่ได้ (คู่มือ, LINE) และการ์ด "เพิ่มรายการใหม่" ในหน้าสมุดรายรับรายจ่ายเหลือกรอบเปล่าเมื่อผู้ใช้มีเพียง `expense.create` (`apps/web/src/features/accounting-documents/IncomeExpenseLedgerPage.tsx:635`)
- **ข้อเสนอแก้**: spec §9 เพิ่มแถว: `| การ์ด "เพิ่มรายการใหม่" ใน ledger | เงื่อนไขแสดงการ์ดใช้ helper เดียวกับปุ่ม ไม่เหลือการ์ดเปล่า |`, `| ข้อความลิงก์ "ไม่มีไฟล์ใบเสร็จ… บันทึกด้วยมือ…" ในหน้าอัปโหลด | คงไว้โดยเจตนา เพราะพาไป wizard ใบรับรองแทนใบเสร็จ ไม่ใช่หน้า manual |`, `| e2e ที่เปิดหน้า manual (ดูรายการใน review หัวข้อ 3) | ยังต้องผ่านเมื่อค่าเริ่มต้นเป็นเปิด และมี e2e ใหม่สำหรับ OFF |`
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-12 สัญญา session กว้างเกินจำเป็น และ "ไม่รู้ค่า = ปิด" เสี่ยงใช้งานไม่ได้

- **หลักฐาน**: spec §6.1–6.2 (ส่ง `entitledFeatureKeys` ทั้งรายการ และตารางสามสถานะ array/null/หาย), §15 ข้อ 4 · `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts:129-131` (ถ้า `expenses` หรือ `expenses.manual` ปิด `expense.create` ถูกตัดอยู่แล้ว) · รันจริง: ชุดสิทธิ์เท่ากันทุกตัวเมื่อสลับเฉพาะ key ใหม่
- **สิ่งที่จะผิดพลาด**: (ก) predicate ตรวจสาม key แต่สอง key แรกซ้ำกับ `expense.create` ที่บังคับอยู่แล้ว ข้อมูลที่เว็บต้องรู้เพิ่มมีเพียง boolean ตัวเดียว การส่งทั้งรายการเพิ่มกรณีทดสอบและทำให้ fingerprint ไวต่อการเปลี่ยนสิทธิ์ที่ไม่เกี่ยว (ข) "field หาย → ไม่รับเข้า แสดง retry" หมายความว่าถ้า API ตอบโดยไม่มี field (rollback หรือข้อผิดพลาด) ทุกร้านเข้าหน้าบันทึกด้วยมือไม่ได้ ทั้งที่ค่าเริ่มต้นคือเปิดและสวิตช์ไม่ใช่ตัวป้องกันความปลอดภัย
- **ข้อเสนอแก้**: spec §6.1 แทนที่ตารางสามสถานะด้วย: `GET /v1/auth/me เพิ่ม field เดียว manualExpenseWebEntry: boolean ที่ server คำนวณ (true เมื่อไม่มีการสั่งปิด) เว็บไม่รับรายการ feature ทั้งชุด` และ §6.2 แทนที่ predicate ด้วย: `canOpenManualWeb = session เป็นของบริษัทที่เปิดอยู่ AND permissions มี expense.create AND manualExpenseWebEntry !== false` พร้อมหมายเหตุ: `ค่าหายหรืออ่านไม่ได้ให้ถือว่าเปิด เพราะ API เป็นผู้ตัดสินสิทธิ์จริงอยู่แล้ว` และ §6.3 แทนที่ bullet แรกด้วย: `- เพิ่มเฉพาะ boolean ตัวนี้ใน accessContextFingerprint ไม่ใส่รายการ feature ทั้งชุด เพื่อไม่ให้การเปลี่ยนสิทธิ์ที่ไม่เกี่ยว (เช่นการซื้อแพ็กเกจ) สั่ง router.refresh() ทุกแท็บของร้าน`
- **เจ้าของต้องตัดสิน**: ใช่ — "ถ้าระบบอ่านค่าสวิตช์ไม่ได้ชั่วคราว ให้แสดงเมนูไว้ก่อน หรือซ่อนไว้ก่อน" คำตอบที่แนะนำ: แสดงไว้ก่อน

#### RM-13 "admission" ตัดสินที่ไหน เก็บที่ไหน ยังไม่ชัด

- **หลักฐาน**: spec §7.1 ("client entry gate ที่มี props จาก server และ revalidate เมื่อเป็น stale/back-navigation"), §7.2, AC05 · `apps/web/app/(workspace)/companies/[companyId]/expenses/manual/page.tsx:4-12` · `apps/web/src/features/expenses/ExpensesPages.tsx:2943-2951,2972` · เอกสาร Next 16.3.4 ที่ติดตั้ง (`next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md`): หน้า dynamic ไม่ถูก cache ตอนไปข้างหน้า แต่ back/forward ใช้ cache เสมอ และ layout ที่ใช้ร่วมไม่ถูกดึงใหม่ทุกครั้ง
- **สิ่งที่จะผิดพลาด**: (ก) ไม่มีสัญญาณใน router ให้ client รู้ว่า props "stale" กฎในสเปกจึงทำตามไม่ได้ ผู้ทำจะเลือกเองคนละแบบ (ข) ถ้ามีคนทำให้ server ไม่ render ฟอร์มเมื่อ OFF ฟอร์มที่รับเข้าแล้วจะหายตอน `router.refresh()` ซ้ำอาการ F08 (ค) ผู้อ่านเข้าใจว่า "ปิด admission" คือ server ปฏิเสธ ทั้งที่ server ตอบ 200 เสมอและโค้ดฟอร์มถูกส่งมาทุกครั้ง
- **ข้อเสนอแก้**: spec §7.1 แทนที่ bullet ที่สองด้วย: `- server render gate และฟอร์มเสมอ และส่งค่าทางเข้าเป็น prop; gate เป็น client component ที่ตัดสินครั้งเดียวตอน mount: ถ้า prop เป็นเปิดให้รับเข้าทันที ถ้าเป็นปิดให้แสดงสถานะ unavailable; เมื่อเข้าด้วย back/forward gate เรียก fetchMyContext หนึ่งครั้งก่อนรับเข้า; ผลรับเข้าเก็บใน state ของ gate เท่านั้น` และเพิ่มประโยคท้าย §7: `สถานะ unavailable เป็นสถานะหน้าจอ ไม่ใช่การปฏิเสธของ server และไม่ใช่ขอบเขตความปลอดภัย ผู้มี expense.create ยังสร้างรายการผ่าน API ได้ตามเดิม` และ AC05 เพิ่ม: `ไม่มี HTTP 403 หรือ redirect จาก flag นี้`
- **ที่ตรวจแล้วว่าไม่มีปัญหา**: การเปลี่ยนเฉพาะ flag ไม่ทำให้ใครหลุดจากระบบ เพราะ `router.refresh()` ถูกเรียกหลัง `fetchMyContext` สำเร็จเท่านั้น และสาขา 403 (`apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx:211-215`) ไม่เกี่ยวกับ flag · แต่ละแท็บเก็บผลรับเข้าของตัวเอง · แท็บที่ซ่อนอยู่ไม่ poll จึงเปลี่ยนเมื่อกลับมาแสดง ซึ่งตรงกับที่สเปก §6.3 เขียนไว้ว่าไม่รับรองว่าหายทุกแท็บทันที · layout ของบริษัท (`apps/web/app/(workspace)/companies/[companyId]/layout.tsx:22-55`) ยังเปลี่ยนเส้นทางเมื่อ session หมด ต้องเปลี่ยนรหัสผ่าน หรือต้องยอมรับเงื่อนไข ซึ่งทำให้ฟอร์มหายได้ตามพฤติกรรมเดิมและไม่เกี่ยวกับสวิตช์
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-14 บนมือถือ หน้าเว็บโหลดใหม่เองทำให้ฟอร์มที่กรอกค้างหายและกลับเข้าไม่ได้

- **หลักฐาน**: spec §7.2 ("hard reload … ต้องประเมิน admission ใหม่") · QA บรรทัด 23 และตารางท้าย ("ไม่ใช่ real-device/iOS LINE in-app browser test") · `apps/web/src/features/expenses/ExpensesPages.tsx:2664-2688` (ข้อมูลฟอร์มทั้งหมดอยู่ใน state ของหน้า)
- **สิ่งที่จะผิดพลาด**: พนักงานกรอกรายการบนมือถือ สลับไปแอปอื่นเพื่อดูยอด กลับมาเบราว์เซอร์โหลดหน้าใหม่เอง ฟอร์มหาย (เป็นอยู่แล้ววันนี้) และหลังปิดสวิตช์จะกลับเข้าไปกรอกใหม่ไม่ได้ คำสัญญา "ฟอร์มที่เปิดอยู่ทำต่อได้" จึงอ่อนกว่าที่เขียนบนอุปกรณ์หลักของผู้ใช้
- **ข้อเสนอแก้**: spec §7.2 เพิ่ม bullet: `- ข้อจำกัดที่ยอมรับ: ถ้าเบราว์เซอร์โหลดหน้าใหม่เอง (มือถือสลับแอป, LINE in-app browser) จะถือเป็นการเข้าใหม่และไม่รับเข้าเมื่อ OFF สถานะ unavailable ต้องมีปุ่มไปหน้าอัปโหลดและรายการ` และ §8 เพิ่มข้อความยืนยันก่อนปิด: `พนักงานที่กำลังกรอกอยู่จะบันทึกต่อได้ แต่ถ้าหน้าเว็บถูกโหลดใหม่จะกลับเข้าหน้านี้ไม่ได้ แนะนำให้ปิดนอกเวลางาน`
- **เจ้าของต้องตัดสิน**: ใช่ — "ยอมรับได้ไหมว่าพนักงานที่กรอกค้างบนมือถือ ถ้าหน้าเว็บโหลดใหม่เองหลังปิดสวิตช์ จะกลับเข้าไปกรอกต่อไม่ได้" คำตอบที่แนะนำ: ยอมรับ โดยมีข้อความเตือนผู้ดูแลก่อนปิด

#### RM-15 ข้อความฝั่งผู้ดูแลยังไม่บอกสิ่งที่สวิตช์ทำจริง และไม่มีจุดประสงค์

- **หลักฐาน**: spec §2 (บอกสิ่งที่ทำได้ แต่ไม่บอกว่าปิดเพื่ออะไร), §8 บรรทัด 219 · ทางกรอกด้วยมือที่ยังอยู่หลังปิด: wizard ใบรับรองแทนใบเสร็จ (`apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx:1716,1760` สร้าง `WEB_MANUAL`), ลิงก์ "ไม่มีไฟล์ใบเสร็จ/ใบกำกับภาษี? บันทึกด้วยมือแล้วจัดทำใบรับรองแทนใบเสร็จรับเงิน" (`apps/web/src/common/i18n/workspace-dictionary.ts:850`, `apps/web/src/features/expenses/ExpensesPages.tsx:615-617,2971`), ข้อความ LINE (`apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts:106,212`), API โดยตรง
- **สิ่งที่จะผิดพลาด**: ผู้ดูแลปิดสวิตช์เพราะต้องการให้ทุกรายการมีใบเสร็จ แล้วพบว่าพนักงานยังพิมพ์รายจ่ายเองได้ผ่านใบรับรองแทนใบเสร็จและ LINE และยังเห็นคำว่า "บันทึกด้วยมือ" ในหน้าอัปโหลด
- **ข้อเสนอแก้**: spec §8 แทนที่คำอธิบายสวิตช์ด้วย: `ปิดเพื่อซ่อนเมนู "บันทึกด้วยมือ" และปุ่มที่พาไปหน้านั้นบนเว็บเท่านั้น ไม่ได้ห้ามการบันทึกรายจ่ายด้วยมือ พนักงานยังบันทึกผ่านใบรับรองแทนใบเสร็จ การพิมพ์ใน LINE และการแก้รายการเดิมได้ตามสิทธิ์เดิม` และ spec §2 เพิ่มประโยคแรก: `จุดประสงค์: <เจ้าของระบุ>`
- **เจ้าของต้องตัดสิน**: ใช่ — "ปิดสวิตช์นี้เพื่ออะไร: แค่ซ่อนเมนูให้พนักงานไปใช้การอัปโหลดใบเสร็จ หรือต้องการห้ามพนักงานพิมพ์รายจ่ายเอง" คำตอบที่แนะนำ: แค่ซ่อนเมนู ถ้าต้องการห้ามจริงต้องเป็นงานอีกชิ้นที่ปิดฝั่งระบบหลังบ้านด้วย

#### RM-16 ปิดพร้อม `expenses.upload` แล้วพนักงานไม่มีทางสร้างรายจ่ายบนเว็บ

- **หลักฐาน**: สเปกไม่กล่าวถึงการใช้ร่วมกับ `expenses.upload` · `apps/web/src/features/expenses/ExpensesPages.tsx:2452-2453` (ปุ่มสร้างมีสองปุ่มนี้เท่านั้น), `:2971` (ทางไป wizard อยู่ในแท็บอัปโหลด) · `apps/web/src/features/accounting-documents/IncomeExpenseLedgerPage.tsx:408-412,635-642`
- **สิ่งที่จะผิดพลาด**: ร้านที่ปิด "อัปโหลดใบเสร็จ" อยู่แล้ว เมื่อปิดทางเข้าบันทึกด้วยมือเพิ่ม พนักงานทั่วไปไม่เหลือปุ่มสร้างรายจ่ายบนเว็บเลย โดยไม่มีคำเตือน
- **ข้อเสนอแก้**: spec §8 เพิ่ม bullet: `- ถ้า expenses.upload ของร้านปิดอยู่ ก่อนบันทึกการปิดทางเข้าให้แสดงคำเตือน "ร้านนี้ปิดอัปโหลดใบเสร็จอยู่ พนักงานจะไม่มีปุ่มสร้างรายจ่ายบนเว็บ" และให้ผู้ดูแลยืนยัน`
- **เจ้าของต้องตัดสิน**: ใช่ — "ถ้าร้านปิดทั้งอัปโหลดใบเสร็จและทางเข้าบันทึกด้วยมือ จะยอมให้ปิดทั้งคู่ไหม" คำตอบที่แนะนำ: ยอม แต่เตือนผู้ดูแลก่อนบันทึก

#### RM-17 พึ่งกติกา "ไม่มีแถว = เปิด" ที่มีแผนจะถอดออก

- **หลักฐาน**: spec §5.1 บรรทัด 105, 108 ("ไม่ backfill") · `docs/specs/feature-entitlement-decoupling-spec.md:271` ("Only after that evidence may one PR remove API and web legacy semantics together") · `apps/api/src/modules/employee-access/application/entitlement.helper.ts:59-63` · `apps/api/src/modules/employee-access/application/normalize-entitlements.ts:117,231-305`
- **รันจริง**: `planCompanyNormalization` กับร้าน EXPLICIT 62 แถวหลังเพิ่ม key คืน write หนึ่งรายการ (`MATERIALIZED_IMPLICIT`, true) แปลว่า `--verify` จะรายงานทุกร้านเป็น DRIFTED
- **สิ่งที่จะผิดพลาด**: เมื่อถึงวันถอดกติกา legacy ร้านที่ไม่มีแถว key ใหม่จะกลายเป็นปิดพร้อมกันทั้งระบบ และการรัน verify ระหว่างนี้จะแดงทุกร้านด้วยเหตุที่ไม่เกี่ยวกับปัญหาจริง
- **ข้อเสนอแก้**: spec §15 เพิ่มข้อ 7 (ใช้เมื่อเลือกแบบ A): `7. key นี้อาศัยกติกา "submenu ที่ไม่มีแถว = เปิด" ก่อน PR ที่ถอด legacy semantics ตาม decoupling spec ต้องมีขั้นตอนเติมแถว key นี้ให้ทุกร้านเป็นค่าที่มีผลจริง และ normalize-entitlements --verify จะรายงาน DRIFTED สำหรับร้านที่ยังไม่มีแถว จนกว่าจะเติม`
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-18 ข้อความเรื่อง rollback ใน §15 ไม่ตรง

- **หลักฐาน**: spec §15 ข้อ 3, 4, 6 พูดถึง web เก่ากับ API ใหม่แยกกัน · `infra/api-web/Dockerfile.api-web` (web และ API อยู่ image เดียว) · `apps/api/src/modules/billing/application/billing-feature-entitlements.ts:51` · `apps/api/src/modules/employee-access/application/normalize-entitlements.ts:267-270,781-784` (แถวที่ไม่อยู่ใน catalog ถือเป็น orphan และถูกลบเมื่อ apply)
- **สิ่งที่จะผิดพลาด**: rollback แล้วแถว key ใหม่ยังอยู่ โค้ดเก่าเห็นร้านนั้นมี 63 แถวจาก catalog 62 จึงโยน review และร้านนั้นชำระเงินไม่ได้ สเปกบอกว่า rollback กระทบเพียงการแสดงเมนู
- **ข้อเสนอแก้**: spec §15 ข้อ 6 แทนที่ด้วย: `6. web และ API ออกเป็น image เดียว จึง rollback พร้อมกัน หลัง rollback ร้านที่มีแถว key ใหม่จะมีแถวเกิน catalog ของโค้ดเก่า ซึ่ง billing ของโค้ดเก่าปฏิเสธ ก่อน rollback ต้องมีขั้นตอนที่อนุมัติแล้วสำหรับแถวเหล่านี้ หรือให้ billing รุ่นก่อนหน้าทนแถวเกินได้ก่อนปล่อย key` (แบบ B ไม่มีปัญหานี้)
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-19 แผน: ลำดับ ไฟล์ที่ขาด test ที่เขียวทั้งที่ผิด และไฟล์ที่ถูก pin

- **หลักฐาน**: plan §2 (inventory), §3 (P1 เพิ่ม key ก่อน P3 ที่ดูแล preset/billing), §4 · `infra/security/validate-production-maintenance-release.sh:106,114-116` pin ไฟล์ `auth.guard.ts`, `session-gate.logic.ts`, `server-session.ts`, `companies/[companyId]/layout.tsx` · spec §6.1 ข้อ 4 ระบุ `fetchServerSession` เป็นจุดที่ต้อง forward ทั้งที่ `apps/web/src/common/auth/server-session.ts:47` ส่ง JSON ผ่านอยู่แล้ว · รันจริง: `node infra/security/sync-production-maintenance-release-pins.mjs --check` ได้ `status=current` · รันจริงแบบจำลอง: หลังเพิ่ม key spec ของ onboarding (42), set-partner-features (78), feature-gate (43), menu-entitlement-binding (8), entitlement.helper (10), line-staff-menu (69), partner.controller (33), web-core-workspace (86) เขียวทั้งหมด
- **สิ่งที่จะผิดพลาด**: (ก) ทำ P1 เสร็จแล้ว billing พังทันทีก่อนถึง P3 (ข) ชุด test ในแผนเขียวครบ แต่ค่าเริ่มต้นผิด (RM-04), LINE ถูกล้าง (RM-06), ผู้ดูแลปิดไม่ได้ (RM-05) เพราะไม่มี test ใดตรวจเรื่องเหล่านี้ (ค) ผู้ทำแก้ `server-session.ts` ตามสเปกแล้ว pin ของ production ล้าสมัย
- **ข้อเสนอแก้**:
  - plan §3 เพิ่มกฎก่อน P1: `การเพิ่ม key เข้า catalog และการแก้ billing, onboarding, partner detail, set-partner-features ต้องอยู่ใน commit เดียวกัน ห้าม merge P1 แยก`
  - plan §4 เพิ่มรายการ test ใหม่ที่ต้องเขียน: `(1) ร้าน 62 แถว + catalog ใหม่: billingFeaturePlan ผ่าน (2) onboarding starter: key ใหม่เป็น true (3) partner detail: ร้านเดิมกดปิด leaf ได้ (4) set-partner-features: สลับ key ใหม่ไม่เรียก invalidateLineConversationState และไม่สร้าง RunoffSnapshot (5) fingerprint และ gate ตาม spec §6–7`
  - plan §2 เพิ่มหมายเหตุ: `ไม่ต้องแก้ server-session.ts, session-gate.logic.ts, auth.guard.ts และ companies/[companyId]/layout.tsx (ถูก pin โดย validate-production-maintenance-release.sh) ถ้าจำเป็นต้องแก้ ให้รัน infra/security/sync-production-maintenance-release-pins.mjs และตรวจด้วย --check`
  - spec §6.1 ข้อ 4 ตัด `fetchServerSession` ออกจากรายการ (ต้องแก้เฉพาะ type `WebSession`)
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-20 F02 จริง แต่กระทบเฉพาะบทบาทที่สร้างจากเทมเพลตการเงิน

- **หลักฐาน**: `apps/api/src/modules/expenses/presentation/http/expense.controller.ts:252-255` (`@RequirePermissions('expense.update')`) · `apps/api/src/modules/expenses/application/use-cases/delete-expense.use-case.ts:204-205` · `apps/web/src/features/expenses/expenses.model.ts:1485,1507-1514` · `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts:286-289` (`pack.expense.finance` มี `expense.delete` ไม่มี `expense.update`) · `apps/api/src/modules/employee-access/domain/registries/role-template.registry.ts:55,107,127,153`
- **รันจริง**: ใช้ `DenyByDefaultGuard` กับ metadata ของ `ExpenseController.prototype.removeExpense` จริง บทบาทจากเทมเพลต `tpl.x.finance`, `tpl.trading.finance`, `tpl.service.finance`, `tpl.ecom.finance` ได้ 403 "Insufficient permissions." ส่วนบทบาทในระบบ (`ROLE_GRANTS`) ไม่มีบทบาทใดถือ `expense.delete` โดยไม่มี `expense.update`
- **สิ่งที่จะผิดพลาด**: เอกสารเขียนเหมือนกระทบ FINANCE ("role finance ที่มี delete แต่ไม่มี update", spec §11) แต่บทบาท FINANCE ในระบบมีทั้งสองสิทธิ์ ผู้แก้อาจทดสอบผิดบทบาทและสรุปว่าไม่มีบั๊ก
- **ข้อเสนอแก้**: spec §11 ย่อหน้าสุดท้าย แทนที่ "รวม role finance ที่มี delete แต่ไม่มี update" ด้วย: `รวมบทบาทที่สร้างจากเทมเพลต tpl.x.finance, tpl.trading.finance, tpl.service.finance, tpl.ecom.finance (ได้ expense.delete จาก pack.expense.finance โดยไม่มี expense.update) บทบาท FINANCE, ADMIN, OWNER ในระบบไม่ได้รับผลเพราะมีทั้งสองสิทธิ์` รายละเอียดการทำซ้ำอยู่หัวข้อ 4
- **เจ้าของต้องตัดสิน**: ใช่ — "บั๊กปุ่มลบรายจ่ายฉบับร่างของบทบาทการเงินที่สร้างจากเทมเพลต จะแก้แยกเลยหรือรอ" คำตอบที่แนะนำ: แก้แยกเป็นงานเล็ก ไม่รอฟีเจอร์นี้

#### RM-21 คุณภาพหลักฐาน: harness รันจาก repo ไม่ได้ และยืนยันเป้าหมาย v1

- **หลักฐาน**: `docs/evidence/manual-expense-web-entry-flag-2026-10-01/harness/playwright.manual.config.ts` (`testDir: './e2e'` แต่ไฟล์ spec อยู่ในโฟลเดอร์เดียวกับ config) · `harness/manual-flag-simulation.spec.ts:2-6` (import `./harness/fixtures` ซึ่งไม่มีในตำแหน่งนี้), `:15` (บังคับฐานข้อมูล `127.0.0.1:25463/manual_flag_e2e`), `:32-50` (ชื่อ test "OFF must preserve role permissions" ขณะสลับ `expenses.manual`) · README อ้าง `../run.py` แต่ไฟล์ที่ commit ชื่อ `local-env.py` · ผลลัพธ์เขียนไป path `/tmp/manual-flag-e2e-20261001/…` · `source-before.json` ขนาด 519 KB รวม `.DS_Store` และไฟล์ build
- **สิ่งที่จะผิดพลาด**: ผู้ทำนำ harness ไปใช้เป็นจุดเริ่ม acceptance ของ v2 ทั้งที่ข้อยืนยันหลักผิดภายใต้ v2 (ปิด key เดิมต้องตัดสิทธิ์ตามเดิม) และรันไม่ได้โดยไม่มีเครื่องของผู้เขียน
- **ข้อเสนอแก้**: README ของ evidence เพิ่มบรรทัดแรก: `harness นี้รันจาก repo ไม่ได้และยืนยันเป้าหมาย v1 ที่ถูกยกเลิก ห้ามใช้เป็นฐานของ acceptance v2 e2e ของ v2 ให้เขียนใหม่ใน e2e/ โดยสลับ key ใหม่` และพิจารณาย้ายโฟลเดอร์ `harness/` กับ `source-before.json` ออกจาก repo เก็บเฉพาะผล JSON กับภาพหน้าจอ
- **ภาพหน้าจอ 6 ภาพ** (เปิดดูครบ): `focus-refresh-off.png` แสดง "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้" แทนฟอร์ม, `active-submit-off.png` แสดงฟอร์มที่กรอกแล้วกับข้อความ "ยังไม่ได้เปิดฟีเจอร์นี้", `wizard-false.png` แสดงปุ่มสร้างถูกปิดพร้อมข้อความ "บัญชีนี้ไม่มีสิทธิ์สร้างรายการค่าใช้จ่าย", `lost-response-off.png` แสดงข้อความปฏิเสธและฟอร์มหายไปแล้ว, `multi-upload-off.png` แสดงรายการที่มีเพียงปุ่ม "อัปโหลดใบเสร็จ" ทั้งห้าภาพสนับสนุนข้ออ้างของ key เดิม · `admin-preset.png` สนับสนุนไม่เต็ม: ป้าย "เมนูย่อย 6/6" และ "มีการเปลี่ยนแปลง 44 รายการ" ตรงกับข้ออ้างว่า preset เปิด manual กลับ แต่ตัวสวิตช์ "บันทึกด้วยมือ" ในภาพยังไม่อยู่ในตำแหน่งเปิด และสวิตช์ "ลงบัญชีค่าใช้จ่ายอัตโนมัติ" ยังแสดงเปิดทั้งที่ `applyPreset` ปิดเสมอ ภาพน่าจะถูกถ่ายก่อนหน้าจอวาดเสร็จ หลักฐานที่ใช้ได้จริงของข้อนี้คือค่า `manualTurnsOn: 1` ใน `observations-summary.json`
- **ข้ออ้างของ v2 ที่ยังไม่มีหลักฐานเลย**: AC01 (leaf ใหม่และค่าเดิมไม่เปลี่ยน), AC02 (สิทธิ์เท่าเดิมเมื่อสลับ key ใหม่ — ผู้รีวิวรันในหน่วยความจำแล้วเท่ากัน แต่ยังไม่มีในชุดเอกสาร), AC03 (`/auth/me` ส่ง field), AC04 และ AC05 (ซ่อนทางเข้าและ gate ด้วย key ใหม่ — หลักฐานเดิมซ่อนได้เพราะสิทธิ์ถูกตัด ไม่ใช่เพราะ predicate ใหม่), AC06 (ฟอร์มที่รับเข้าแล้วอยู่ต่อ — หลักฐานเดิมแสดงผลตรงข้าม), AC07 (fingerprint), AC08 (สลับบริษัท), AC09–AC16 (ไม่เปลี่ยนเมื่อสลับ key ใหม่ — หลักฐานเดิมเป็นการปิด key เดิม), AC17 (preset และ billing — ผู้รีวิวพบว่าผิด), AC18–AC19 (หน้าผู้ดูแลกับ key ใหม่ — ผู้รีวิวพบว่าปิดไม่ได้), AC20
- **เจ้าของต้องตัดสิน**: ไม่

### 2.4 รายละเอียด — เล็กน้อย

#### RM-22 ข้อขัดกันภายในเอกสาร

- **หลักฐานและข้อเสนอแก้**:
  - spec บรรทัด 68 (F07 Target "รักษาค่า manual ที่มีอยู่เมื่อใช้ preset") ขัดกับ §10 ข้อ 2 ("ไม่แก้ preset semantics ของ `expenses.manual`") แทนที่ช่อง Target ด้วย: `รักษาค่าปัจจุบันของ key ใหม่เมื่อใช้ preset; พฤติกรรมของ expenses.manual คงเดิม`
  - spec บรรทัด 62 "9 บทบาท": ที่ `develop` มี 10 บทบาทที่ถือ `expense.create` (เพิ่ม HR) และ harness ไม่ได้ทดสอบ HR แทนที่ด้วย: `E2E ยืนยันกับ 9 จาก 10 บทบาทที่ถือ expense.create (ไม่ได้ทดสอบ HR)` และ §5.2 แทนที่รายชื่อบทบาทด้วย: `ทุกบทบาทใน ROLE_GRANTS และทุกเทมเพลตใน ROLE_TEMPLATES`
  - spec บรรทัด 66 (F05 "roles/permissions/scopes เท่านั้น"): fingerprint รวม `roleNames` ด้วย (`apps/web/src/features/web-core-workspace/workspace-scope.api.ts:27-33`)
  - audit มีข้อความ v1 ค้าง 3 จุด: บรรทัด 54 ("ถอด visibility flag ออกจากทั้ง create/update" — v2 ไม่ถอดอะไรจาก key เดิม), บรรทัด 51 ("ใช้เดิม เพิ่ม copy และ preset preservation เท่านั้น" — v2 ต้องมีสวิตช์ย่อยใหม่ด้วย), บรรทัด 115 ("ผลกระทบที่ต้องหายไป" — ภายใต้ v2 การปิด key เดิมยังต้องตัด mark-ready ตามเดิม) แทนที่ช่องผลของบรรทัด 54 ด้วย: `ไม่แตะ create/update; เพิ่มเงื่อนไขทางเข้าเฉพาะปุ่มและหน้า manual` ช่องผลของบรรทัด 51 ด้วย: `ใช้ command เดิม เพิ่มสวิตช์ย่อย ข้อความ และการรักษาค่าเมื่อใช้ preset` และวงเล็บของบรรทัด 115 ด้วย: `(พฤติกรรมของ key เดิมซึ่ง v2 คงไว้)`
  - spec §3 ตั้งชื่อหัวข้อว่า "Current-state findings ที่ต้องปิด" แต่ F02 อยู่นอกขอบเขตตาม §1 ข้อ 6 และ F03 ปิดไปแล้ว ให้เพิ่มคอลัมน์ `ขอบเขต` ที่มีค่า `งานนี้ / แยก / ปิดแล้ว`
  - memory บรรทัด 25 "No unresolved owner-scope question" ไม่จริงแล้ว มีคำถามถึงเจ้าของ 8 ข้อในรีวิวนี้
  - spec, plan ระบุ "READY FOR IMPLEMENTATION" ขณะที่ memory ระบุว่ายังไม่ได้รับอนุญาตให้ implement ให้ใช้สถานะเดียวกันตาม RM-01
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-23 `toggleSubmenu` เปิด parent ให้เอง ขัดกับ §5.1

- **หลักฐาน**: spec §5.1 บรรทัด 106 ("ON ตัวใหม่ไม่เปิด parent/ฟีเจอร์เดิม/permission ให้เอง") · `apps/web/src/features/system-partners/system-partners.logic.ts:249-272` · รันจริง: เปิด leaf ขณะ `expenses` ปิด แล้ว `expenses` กลายเป็นเปิด
- **สิ่งที่จะผิดพลาด**: ถ้าปุ่มไม่ถูก disable ครบทุกกรณี การเปิดสวิตช์หน้าจอจะเปิดทั้งโมดูลค่าใช้จ่ายให้ร้านที่ไม่ได้ซื้อ
- **ข้อเสนอแก้**: spec §8 เพิ่ม: `leaf นี้ต้องไม่ใช้ toggleSubmenu เดิมที่เปิด parent ให้เอง Test: เปิด leaf ขณะ expenses ปิดแล้ว expenses ยังปิด`
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-24 route ซ้ำ `prefetch={false}` และไฮไลต์เมนู

- **หลักฐานและข้อเสนอแก้**:
  - leaf ใช้ `route: '/expenses/manual'` ซ้ำกับ `expenses.manual` หน้าผู้ดูแลแสดง route และค้นหาด้วย route (`apps/web/src/features/system-partners/system-partners.logic.ts:475-490`) จะได้สองแถว ระบุใน §8 ว่า leaf ไม่แสดง route
  - spec §7.1 แนะนำ `prefetch={false}`: ตามเอกสาร Next 16.3.4 หน้า dynamic ไม่ถูก prefetch เต็มอยู่แล้ว จึงไม่จำเป็น ให้ตัดออกหรือระบุว่าเป็นทางเลือก
  - เมื่อรายการเมนูหาย ฟอร์มที่รับเข้าแล้วจะถูกไฮไลต์เป็น "รายการค่าใช้จ่าย" (`apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:409-428`) เป็นเรื่องหน้าตาเท่านั้น
- **เจ้าของต้องตัดสิน**: ไม่

#### RM-25 memory `manual-expense-multi-item` มี "Next" ค้างที่ไม่จริงแล้ว

- **หลักฐาน**: `docs/agent-memory/manual-expense-multi-item.md` บรรทัด 44–46 ("Host E2E + commit … all uncommitted") ขณะที่ฟอร์มหลายรายการอยู่บน `develop` แล้ว (`apps/web/src/features/expenses/ExpensesPages.tsx:2667`)
- **ข้อเสนอแก้**: แก้สถานะ Next เป็นเสร็จแล้ว และเพิ่มหมายเหตุว่า state ที่ gate ต้องรักษาคือ `items`, `serviceCharge`, ภาษี, `receiptFile`, `savedExpenseId`, `draftSave` (`ExpensesPages.tsx:2666-2688`)
- **เจ้าของต้องตัดสิน**: ไม่

## 3. รายการทางเข้าทั้งหมดที่พบ

"ครอบคลุม" หมายถึงสเปก §7 หรือ §9 ระบุไว้ · "ในขอบเขต" ตีความตามคำตัดสินของเจ้าของว่าปิดเฉพาะทางเข้าบนเว็บ

| รหัส | ทางเข้า | ตำแหน่ง | สเปก | ในขอบเขตที่ต้องซ่อน |
| --- | --- | --- | --- | --- |
| E01 | เมนูย่อย "บันทึกด้วยมือ" ใน sidebar (desktop และมือถือใช้ตัวเดียวกัน) | `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts:266-274` | ครอบคลุม | ใช่ |
| E02 | ปุ่ม "บันทึกเอง" บนหน้ารายการ | `apps/web/src/features/expenses/ExpensesPages.tsx:2453` | ครอบคลุม | ใช่ |
| E03 | URL ตรง `/expenses/manual` (รวม bookmark, ประวัติเบราว์เซอร์, reload) | `apps/web/app/(workspace)/companies/[companyId]/expenses/manual/page.tsx:4-12`, `ExpensesPages.tsx:2943-2951,2972` | ครอบคลุม | ใช่ (ผ่าน gate) |
| E04 | alias `/expenses?tab=manual` | `ExpensesPages.tsx:2916-2925` (เปลี่ยนเส้นทางไป E03) | ครอบคลุม | ใช่ (ผ่าน gate) |
| E05 | ปุ่ม "กรอกรายจ่ายเอง" ในการ์ด "เพิ่มรายการใหม่" ของสมุดรายรับรายจ่าย | `apps/web/src/features/accounting-documents/IncomeExpenseLedgerPage.tsx:642` | ครอบคลุม | ใช่ |
| E06 | empty state "กรอกรายจ่ายรายการแรก" | `IncomeExpenseLedgerPage.tsx:408-412` | ครอบคลุม | ใช่ |
| E07 | เงื่อนไขแสดงการ์ด "เพิ่มรายการใหม่" (เหลือการ์ดเปล่า) | `IncomeExpenseLedgerPage.tsx:635` | พลาด | ใช่ |
| E08 | ลิงก์ "เปิดหน้าบันทึกด้วยมือ" ในคู่มือ | `apps/web/src/features/user-guide/expenses-guide.content.ts:240` | ครอบคลุม | ใช่ |
| E09 | การ์ดคำแนะนำ "บันทึกค่าใช้จ่ายด้วยมือ" ในหน้า AI แนะนำ | `apps/web/src/features/ai-suggestions/ai-suggestions.logic.ts:168`, `AiSuggestionsPages.tsx:62` | ครอบคลุม | ใช่ |
| E10 | หัวข้อคู่มือ "บันทึกด้วยมือ" ทั้งหัวข้อ และ anchor `#manual` | `expenses-guide.content.ts:228-262` | พลาด | รอเจ้าของ (RM-10) |
| E11 | ข้อความคู่มือ "อัปโหลดใบเสร็จหรือบันทึกเอง", ขั้นตอน "หรือบันทึกด้วยมือ", แถวตารางเมนูย่อย | `expenses-guide.content.ts:36,53,92` | พลาด | รอเจ้าของ (RM-10) |
| E12 | คู่มือฉบับ .docx ที่ไฟล์คู่มืออ้างถึง | `expenses-guide.content.ts:4` (ไฟล์อยู่นอก repo) | พลาด | รอเจ้าของ (RM-10) |
| E13 | ลิงก์กลับจากหน้าตั้งค่ารหัสภาษี | `apps/web/src/features/tax/TransactionTaxLineSelector.tsx:88-94` (แสดงเฉพาะในฟอร์ม manual `ExpensesPages.tsx:2828`) | ครอบคลุม | ใช่ (ผ่าน gate) |
| E14 | ลิงก์ "ไม่มีไฟล์ใบเสร็จ/ใบกำกับภาษี? บันทึกด้วยมือแล้วจัดทำใบรับรองแทนใบเสร็จรับเงิน" ในหน้าอัปโหลด | `ExpensesPages.tsx:615-617,2971`, `apps/web/src/common/i18n/workspace-dictionary.ts:850` | ครอบคลุมบางส่วน (ระบุว่าคงไว้ แต่ไม่พูดถึงถ้อยคำ) | ไม่ (เจ้าของให้คง wizard) |
| E15 | สร้างรายการใหม่ใน wizard ใบรับรองแทนใบเสร็จ (`WEB_MANUAL`) | `apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx:1716,1760` | ครอบคลุม | ไม่ |
| E16 | กรอกแก้ผล OCR ในหน้ารายละเอียด | `ExpensesPages.tsx:1136` (`ExpenseReviewEditSection`) | ครอบคลุม | ไม่ |
| E17 | deep link ผ่านหน้า login (`next`) และ back/forward | ลงที่ E03 | ครอบคลุม (กฎ back/forward ยังไม่ชัด RM-13) | ใช่ (ผ่าน gate) |
| E18 | ลิงก์เว็บในข้อความตอบของ LINE | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` และไฟล์ข้างเคียง: ทุกลิงก์ไป `/expenses`, `/expenses/{id}`, `/expenses/signatures`, `/expenses/substitute-receipts/…` ไม่มี `/expenses/manual` | ไม่เกี่ยว | ไม่มีสิ่งต้องซ่อน |
| E19 | ลิงก์ในแจ้งเตือนและแดชบอร์ด | `apps/api/src/modules/dashboard-notifications/application/providers/expense-summary.provider.ts:34`, `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts:419` ไม่มี `/expenses/manual` | ไม่เกี่ยว | ไม่มีสิ่งต้องซ่อน |
| E20 | LINE rich menu และเมนูพนักงาน | `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:149,176-177` ไม่มีลิงก์ไปหน้า manual | ไม่เกี่ยว | ไม่มีสิ่งต้องซ่อน |
| E21 | การ์ดคำตอบ LINE `expense.start` ("…หรือบันทึกด้วยมือ") | `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts:38-39` | พลาด | รอเจ้าของ (RM-10) |
| E22 | พิมพ์รายจ่ายใน LINE ("ค่ากาแฟ 65 บาท") | `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts:106,212` | ครอบคลุม (คงไว้) | ไม่ แต่ควรบอกผู้ดูแล (RM-15) |
| E23 | e2e ที่เปิดหน้า manual | `e2e/expenses.spec.ts:124-127`, `e2e/transaction-tax.spec.ts:37`, `e2e/transaction-branch.spec.ts:47,75,163`, `e2e/settings.spec.ts:391`, `e2e/evidence.spec.ts:20`, `e2e/responsive.spec.ts:21,95,120,704-705`, `e2e/local-active-feature-regression.spec.ts:91`, `e2e/expense-number-save.spec.ts:21` | พลาด (แผนกล่าวถึงเพียง `e2e/expenses.spec.ts`) | ไม่ต้องซ่อน แต่ต้องยังผ่าน |
| E24 | ตารางความคาดหวังเมนูต่อบทบาทของ e2e | `e2e/harness/roles.ts:153`, `e2e/sidebar-nav.spec.ts` | พลาด | ไม่ต้องซ่อน แต่ต้องยังผ่าน |
| E25 | unit spec ที่ pin ลิงก์ | `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts:500-509,949`, `apps/web/src/features/user-guide/user-guide.content.spec.ts:81`, `apps/web/src/features/ai-suggestions/ai-suggestions.logic.spec.ts:112` | ครอบคลุมโดยอ้อมใน plan §4 | ไม่ต้องซ่อน |
| E26 | API โดยตรง `POST /v1/companies/:companyId/expenses` | `apps/api/src/modules/expenses/presentation/http/expense.controller.ts:237-238` | ครอบคลุม (AC09 คงไว้) | ไม่ แต่ต้องเขียนให้ชัดว่าไม่ใช่การห้าม (RM-13, RM-15) |
| E27 | ทางลัดบนแดชบอร์ดและ checklist ตั้งค่าร้าน | ค้นแล้วไม่มีลิงก์ไปหน้า manual (คีย์ `dashboard.home.shortcuts_*` ใน dictionary ไม่มีผู้ใช้) | ไม่เกี่ยว | ไม่มีสิ่งต้องซ่อน |
| E28 | บรรทัดคำขอเบิกที่พิมพ์ด้วยมือ | โมดูล `/reimbursements` แยกต่างหาก ไม่พาไปหน้า manual | ครอบคลุม (คงไว้) | ไม่ |

## 4. บั๊กในระบบปัจจุบันที่ควรแก้แยกจากฟีเจอร์นี้

### B1 ปุ่มลบรายจ่ายฉบับร่างใช้ไม่ได้กับบทบาทที่สร้างจากเทมเพลตการเงิน (F02) — กัดผู้ใช้วันนี้ถ้ามีร้านใช้เทมเพลตนี้

- **ทางทำซ้ำ**: (1) ในร้านใดก็ได้ สร้างบทบาทจากเทมเพลต "การเงิน" (`tpl.x.finance`, `tpl.trading.finance`, `tpl.service.finance` หรือ `tpl.ecom.finance`) แล้วมอบให้พนักงาน (2) พนักงานเปิดรายจ่ายสถานะฉบับร่างที่ลบได้ ปุ่มลบแสดงเพราะ `canDelete = has('expense.delete')` (`apps/web/src/features/expenses/expenses.model.ts:1485,1507-1514`) (3) กดลบ → `DELETE /v1/companies/:companyId/expenses/:expenseId` ตอบ 403 "Insufficient permissions." เพราะ controller บังคับ `expense.update` (`expense.controller.ts:252-255`) ขณะที่ use case ยอมรับ `expense.delete` (`delete-expense.use-case.ts:204-205`)
- **ขอบเขต**: บทบาทในระบบ (OWNER, ADMIN, FINANCE และอื่น ๆ) ไม่ได้รับผล ผู้รีวิวยืนยันด้วย guard จริงและ registry จริง โค้ดสามจุดนี้เหมือนกันบน `origin/main` และ `908e7aab` จึงเป็นบั๊กของโค้ดที่ใช้งานอยู่ แต่ไม่ได้ตรวจว่ามีร้านใน production ใช้เทมเพลตนี้หรือไม่ เพราะไม่ได้เข้าฐานข้อมูล
- **แนวแก้**: ตาม spec §11 (เปลี่ยน guard เป็น `RequireAnyPermission('expense.delete', 'expense.update')` โดย use case ยังตรวจเจ้าของและสถานะ) ไม่ต้องรอฟีเจอร์สวิตช์ · ถ้าแก้ ให้ปรับแถว DELETE ใน `docs/specs/feature-entitlement-runoff-matrix.json` ที่ยังระบุ `expense.update` ด้วย

### B2 บั๊ก LINE idempotency key (F03) — ไม่ใช่บั๊กปัจจุบัน

- แก้แล้วใน `6fddca795` (2026-09-29) และเนื้อหาอยู่ใน `origin/main`, `origin/develop`, `e52c151a`, `908e7aab` ตามที่ตรวจด้วย `git show <ref>:…/expense-document.use-case.ts` หมายเหตุในโค้ดระบุว่าบั๊กเกิดตั้งแต่ `3d7379ef` (2026-09-11) จนถึงวันที่แก้ ผู้รีวิวไม่ได้ตรวจ production โดยตรง สิ่งที่ต้องทำมีเพียงถอนข้อความใน spec, plan, audit, QA และ memory ตาม RM-02

### B3 ดีลที่เลือกเมนูทีละรายการหลังกด "ล้างทั้งหมด" จะปิดเมนูย่อยค่าใช้จ่ายทั้งหมดเมื่อชำระเงิน — พบเพิ่มระหว่างรีวิว

- **ทางทำซ้ำ**: (1) ในหน้าสร้างดีลของฝ่ายขาย กด "ล้างทั้งหมด" แล้วกดเลือกเมนู "ค่าใช้จ่ายและใบเสร็จ" → `toggleMenuSelection` ใส่เฉพาะ `expenses` ไม่ใส่ key เมนูย่อย (`apps/web/src/features/sales-console/sales-console.logic.ts:389-402`, binding `packages/contracts/src/menu-entitlements.ts:168-173`) (2) server เก็บ `featureKeys` ตามที่ส่งมา (`apps/api/src/modules/sales-console/domain/sales-deal.logic.ts:149-151,180`) (3) ลูกค้าชำระเงิน → `billingFeaturePlan` เขียนทุก key ใน catalog ที่ไม่อยู่ในรายการเป็น false (`billing-feature-entitlements.ts:68-70,96`)
- **รันจริง** (โค้ดปัจจุบัน ไม่มีการจำลอง): เป้าหมาย `['expenses','dashboard_notifications']` กับร้าน 62 แถว ได้ `expenses=true` แต่ `expenses.list`, `expenses.upload`, `expenses.manual`, `expenses.categories`, `expenses.evidence`, `expenses.signatures` เป็น false ทั้งหมด สิทธิ์ที่เหลือหลัง apply จากชุด read/create/update/upload/review/confirm คือ `expense.review` กับ `expense.confirm` เท่านั้น
- **ขอบเขต**: ดีลที่เริ่มจากค่าเริ่มต้น (ชุด starter ครบ) ไม่ได้รับผล ไฟล์ที่เกี่ยวข้องบน `origin/main` ไม่ต่างจาก `develop` ผู้รีวิวไม่ได้ทดสอบผ่านเบราว์เซอร์และไม่ได้ตรวจว่ามีดีลจริงที่สร้างด้วยวิธีนี้ หน้าชำระเงินจะแสดงรายการเมนูที่จะหยุดใช้ให้ลูกค้าเห็นก่อนจ่าย กลไกเดียวกันนี้คือเหตุของ RM-04
- **แนวแก้**: ให้ billing ถือว่าการระบุ parent หมายถึงเมนูย่อยที่ไม่ได้ถูกสั่งปิด หรือให้หน้าดีลใส่ key เมนูย่อยเมื่อเลือกเมนู

### B4 จุดเปราะ: billing ฝังขนาด catalog (62 และ 60) ไว้ในโค้ด — ยังไม่กัดผู้ใช้วันนี้

- `apps/api/src/modules/billing/application/billing-feature-entitlements.ts:54-57` การเพิ่ม key ใดก็ตามเข้า catalog ในอนาคต ไม่เฉพาะงานนี้ จะทำให้ร้านเดิมชำระเงินไม่ได้จนกว่าจะแก้ส่วนนี้ ควรเปลี่ยนเป็นรายการรูปชุดแถวในอดีตที่ระบุชัด และมี test "ร้านที่ normalize ด้วย catalog รุ่นก่อนยังซื้อได้" แยกจากงานสวิตช์

## 5. ข้ออ้างที่ตรวจแล้วว่าถูก

- F01: `expenses.manual` ถือ `permissionKeys: ['expense.create', 'expense.update']` (`packages/contracts/src/feature-entitlements.ts:91-97`) และกฎ subfeature มาก่อนกฎ pack (`feature-gate.logic.ts:129-131`)
- `pack.expense.self` เป็น pack เดียวที่ถือ `expense.create` และ `expense.update` และผูกกับ `expenses` (`capability-pack.registry.ts:270`)
- F04: resolver คืน `entitledFeatureKeys` (`prisma-permission-resolver.repository.ts:126`) แต่ `ResolveRequestContextUseCase` ไม่ส่งต่อ (`resolve-request-context.use-case.ts:42-53`), `/auth/me` ไม่คืน (`auth.controller.ts:1012-1053`), `WebSession` ไม่มี field (`web-session.model.ts:2-18`) และมีผู้สร้าง `RequestContext` เพียงจุดเดียวคือ `auth.guard.ts:245`
- F05: fingerprint ไม่มีข้อมูลฟีเจอร์ (`workspace-scope.api.ts:25-34`) และตัวกระตุ้น refresh คือ focus, visibilitychange, `ACCESS_CONTEXT_STALE_EVENT`, poll 60 วินาที (`WorkspaceLayout.tsx:73,200-234`)
- F07: `applyPreset` ไม่อ่าน state เดิม (`system-partners.logic.ts:274-288`)
- F02: guard กับ use case ไม่ตรงกัน (ดู B1)
- F08: เมื่อสิทธิ์ `expense.create` หาย หน้า hub แทนเนื้อหาแท็บด้วย `<StateBanner error="Forbidden" />` (`ExpensesPages.tsx:2943,2951`) ฟอร์มจึงถูก unmount ตรงกับภาพ `focus-refresh-off.png`
- validator ของ draft key คือ `/^[A-Za-z0-9_-]{8,64}$/` (`accounting-money-validation.logic.ts:10`) และถูกตรวจก่อนสิทธิ์ (`expense-draft.use-case.ts:109-113`)
- `parentFeatureKey('expenses.manual.web_entry')` คืน `expenses` — รันจริง
- เมื่อสลับเฉพาะ key ใหม่ ชุดสิทธิ์เท่ากันทุกตัว และค่า `expenses.manual.web_entry` อยู่ในชุดที่เปิดเมื่อไม่มีแถว — รันจริงกับ `evaluateEntitledFeatureKeys` และ `filterPermissionsByEntitlement`
- `adminOverrideKeys` รักษาค่าที่ผู้ดูแลตั้งไว้เมื่อซื้อแพ็กเกจ — รันจริง (เฉพาะกรณีมี transition ของผู้ดูแล)
- ปิดแล้วเปิดการ์ด "ค่าใช้จ่าย" ทั้งการ์ด ค่าของ leaf คงเดิม — รันจริงกับ `toggleMenuCard`
- alias `?tab=manual` เปลี่ยนเส้นทางไป route เฉพาะ (`ExpensesPages.tsx:2916-2925`) และลิงก์ "ไม่มีเอกสาร" ไป wizard ไม่ใช่หน้า manual (`:2971`)
- ไม่มีโค้ดฝั่ง API, AI Gateway หรือ worker ที่อ้าง key `expenses.manual` ตรง ๆ (มีผลผ่าน `SUBFEATURE_RULES` เท่านั้น) จึงไม่มีจุดใดใน reimbursement, marketplace capture, capture group, รายงาน หรือ ledger ที่จะอ่าน key ใหม่โดยไม่ตั้งใจ
- การเปลี่ยนค่าผ่าน command เดิมมี audit `system.partner_feature.update` ระดับ HIGH พร้อม `changedKeys`, `commandId`, `setVersion` (`set-partner-features.use-case.ts:569-599`) และ CAS/replay ตามที่สเปก §10 ข้อ 7 อ้าง
- การออกแบบไม่เพิ่ม environment switch (spec §5.1 และ plan §1 ระบุชัด และไม่มีจุดใดในชุดเอกสารอ้าง env สำหรับฟีเจอร์นี้)
- ตัวเลขผลทดสอบตรงกับไฟล์: `case-results.json` มี 72 กรณี ผ่าน 55 ไม่ผ่าน 17 แยกเป็น main 22/11, extended 7/2, recheck 1/2, OFF regression 7/0, ON regression 10/2 บวก selector recheck 2/0, WebKit 6/0
- ไฟล์ทั้งหมดที่ plan §4 อ้างมีอยู่จริงที่ `ae13970b0` · ชุด test ฐานเขียว: API 6 ไฟล์ 151 ข้อ, web 5 ไฟล์ 227 ข้อ
- pin ของ production maintenance เป็นปัจจุบัน (`status=current`, 48 ไฟล์)

## 6. สิ่งที่ไม่ได้ตรวจ และเหตุผล

- **Production, UAT, ฐานข้อมูลจริง**: ไม่ได้เข้าตามกติกาของงาน จึงไม่ทราบว่ามีร้านใดใช้เทมเพลตการเงิน (B1), มีดีลแบบ B3, หรือร้านใดยังไม่มีแถวสิทธิ์
- **เบราว์เซอร์และ Playwright**: ไม่ได้รันตามกติกา พฤติกรรม `router.refresh()`, back/forward และมือถือจึงอ่านจากโค้ดและเอกสาร Next 16.3.4 ที่ติดตั้ง ไม่ได้ทดลอง
- **PostgreSQL spec**: ไม่มี Docker จึงไม่ได้รัน `*.pg.spec.ts` (normalizer 23 ข้อถูกข้าม)
- **LINE และ AI จริง**: ไม่เรียก model หรือ LINE ผลกระทบต่อ LINE ใน RM-06 ยืนยันด้วยการรัน command จริงกับ Prisma จำลอง ไม่ใช่กับบทสนทนาจริงในฐานข้อมูล ส่วนการปฏิเสธคำตอบจาก fingerprint ที่เปลี่ยน (`drain-line-ledger.use-case.ts:343`) มาจากการอ่านโค้ด
- **สเปกที่เกี่ยวข้อง 7 ฉบับ**: อ่านเฉพาะส่วนที่เกี่ยวกับ key, เมนูย่อย, normalization และ manual entry ไม่ได้รีวิวทั้งฉบับ
- **ทางเลือกแบบ B ใน RM-08**: เสนอจากตัวอย่างที่มีอยู่ (`ocrEnabled`) ไม่ได้ออกแบบ schema หรือประเมินขั้นตอน migration ของ production โดยละเอียด

สิ่งที่รันจริง (ทั้งหมดอยู่ในหน่วยความจำ ไม่แก้ไฟล์ใน repo ไม่ใช้เครือข่าย)

- จำลองการเพิ่ม leaf `expenses.manual.web_entry` โดยแก้ object ของ `@watchdog-bms/contracts` ขณะรัน แล้วเรียกโค้ดจริง: `evaluateEntitledFeatureKeys`, `filterPermissionsByEntitlement`, `billingFeaturePlan`, `planCompanyNormalization`, `disableBlockForChange`, `toggleSubmenu`, `applyPreset`, `buildMenuCards`, `toggleMenuCard`
- รัน spec เดิมภายใต้ catalog จำลอง 16 ไฟล์ (ผลในหัวข้อ RM-09 และ RM-19)
- รัน spec ฐานโดยไม่จำลอง: API 6 ไฟล์ (151 ข้อผ่าน), web 5 ไฟล์ (227 ข้อผ่าน), test NAT12
- ทำซ้ำ F02 ด้วย `DenyByDefaultGuard` กับ metadata ของ controller จริงและเทมเพลตบทบาทจริง
- ทำซ้ำ B3 ด้วย `billingFeaturePlan` จริงโดยไม่จำลอง
- เรียก `SetPartnerFeaturesUseCase` จริงกับ Prisma จำลองเพื่อดูผลต่อ LINE และ run-off เมื่อสลับ key ใหม่
- จำลองผู้ดูแลสลับ key ใหม่ระหว่างที่ billing pin plan ไว้ แล้วเทียบ `sourceHash`
- `node infra/security/sync-production-maintenance-release-pins.mjs --check`
- เทียบ hash ของ `source-before.json` กับไฟล์ที่ `ae13970b0` และตรวจ ancestry ของ commit ด้วย git

วิธีทำซ้ำการจำลอง (ไฟล์ชั่วคราวนอก repo รันด้วย `pnpm exec tsx <ไฟล์>.cts` จาก `apps/api`)

```ts
import { createRequire } from 'node:module';
const req = createRequire('<repo>/apps/api/package.json');
const contracts = req('@watchdog-bms/contracts');
const NEW = 'expenses.manual.web_entry';
contracts.FEATURE_CATALOG.find((f: any) => f.key === 'expenses').submenus.push({
  key: NEW, labelTh: 'แสดงทางเข้าบันทึกด้วยมือบนเว็บ', descriptionTh: '-', route: '/expenses/manual', permissionKeys: [],
});
contracts.ALL_FEATURE_ENTITLEMENT_KEYS.push(NEW);
// โหลดโมดูลจริงหลังจากนี้ เช่น billing-feature-entitlements.ts แล้วเรียกด้วยแถว 62 แถวของร้านเดิม
const billing = req('./src/modules/billing/application/billing-feature-entitlements.ts');
```
