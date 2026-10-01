# Spec: สวิตช์ทางเข้าบันทึกค่าใช้จ่ายด้วยมือบนเว็บ

วันที่: 2026-10-01 · Version: 2.0 — additive web-entry flag (owner update)

Status: **READY FOR IMPLEMENTATION — DOCUMENTATION ONLY; ยังไม่ implement และยังไม่เปลี่ยน flag**

Owner: thawatchai · Scope: สวิตช์ย่อยใหม่ `expenses.manual.web_entry` ใต้ฟีเจอร์ `expenses.manual`; สัญญา session และ web entry เท่านั้น

เอกสารประกอบ:

- [Implementation plan](../plans/manual-expense-web-entry-flag-plan-th.md)
- [Impact audit และหลักฐานปัจจุบัน](../research/manual-expense-web-entry-flag-audit-2026-10-01-th.md)
- [Local E2E simulation](../qa/manual-expense-web-entry-flag-e2e-simulation-2026-10-01-th.md)
- [Task memory](../agent-memory/manual-expense-web-entry-flag.md)
- [Feature entitlement decoupling](feature-entitlement-decoupling-spec.md)
- [Submenu entitlement plan เดิม](../plans/feature-entitlement-submenu-plan.md)
- [Expense receipt upload](expense-receipt-upload-spec.md)
- [LINE expense draft conversation](line-ai-expense-draft-conversation-spec.md)
- [LINE edit capability consistency](line-ai-expense-edit-capability-consistency-spec-th.md)
- [Substitute receipt edit sync](substitute-receipt-expense-edit-sync-spec.md)
- [Marketplace capture contract](marketplace-buyer-expense-capture-contract-appendix-th.md)

## 1. Product decision และขอบเขตล่าสุด

Owner ยืนยัน “ปิดแค่ทางเข้าการ manual บน web”, “ยังไม่แก้นะ ทำ spec มาก่อน” และปรับข้อเสนอเป็น **“เอา flag ย่อย ภายใต้ feature บันทึกด้วยมือ ซ่อน ทางเข้า menu นี้ไป เปิดปิดได้ เบื้องหลังทำงานเหมือนเดิม”** เมื่อ 2026-10-01

**เลือกเพิ่มสวิตช์ใหม่ ไม่เปลี่ยนความหมายสวิตช์เดิม**:

- `expenses` = ฟีเจอร์ค่าใช้จ่ายเดิม
- `expenses.manual` = ฟีเจอร์บันทึกด้วยมือเดิม; คง `permissionKeys: ['expense.create', 'expense.update']`
- `expenses.manual.web_entry` = สวิตช์ใหม่สำหรับทางเข้าเว็บ; `permissionKeys: []`

ตลอดเอกสาร v2 คำว่า **entry ON/OFF** หมายถึง key ใหม่เท่านั้น การทดลอง E2E ก่อน owner update ปิด key เดิม จึงเป็นหลักฐาน impact ของวิธีเดิม ไม่ใช่การทดสอบ key ใหม่

1. Admin เห็น switch ย่อย “แสดงทางเข้าบันทึกด้วยมือบนเว็บ” ใต้ฟีเจอร์บันทึกด้วยมือ
2. OFF ซ่อนเมนู/ปุ่ม/ลิงก์ไปยังหน้า manual และปิด admission ใหม่ของ URL นั้น ตามขอบเขต web entry เดิม; ไม่ครอบปุ่มกรอกด้วยมือภายใน OCR/wizard
3. ไม่เปลี่ยน POST/PATCH/DELETE guards, role grants, LINE, OCR, wizard, reimbursements หรือ financial behavior เพราะ switch ใหม่นี้
4. ฟอร์มที่รับเข้าแล้วก่อน OFF กรอก/บันทึกต่อได้ตามสิทธิ์ธุรกิจจริง; reload/เปิดแท็บใหม่หลัง OFF ไม่รับเข้าใหม่
5. บริษัทที่เดิม `expenses.manual=false` ยังคงถูก gate ตามเดิม ห้ามเปิด permission กลับหรือแก้ stored flag อัตโนมัติ
6. บั๊ก DELETE/LINE ที่ audit พบเก็บเป็น follow-up แยก (§11–12); ไม่รวมการแก้หลังบ้านใน diff ของสวิตช์ใหม่นี้

**v2 supersedes v1** ที่เสนอ reuse `expenses.manual` และถอด permission mapping ของ key เดิม รวมทั้งถอนคำแนะนำให้คืน create/update ให้บริษัทที่ปิด key เดิมอยู่แล้ว งานปัจจุบันยังเป็น spec + simulation ไม่มี authorization ให้ implement/deploy

## 2. Goal, ผู้ใช้ และ acceptance outcome

System admin ปิดทางเข้าหน้าบันทึกด้วยมือของบริษัทได้จากหน้าฟีเจอร์เดิม โดยพนักงานยังอัปโหลดใบเสร็จ, กรอกแก้ผล OCR, ทำงานผ่าน LINE และจัดการรายการเดิมได้ตาม role/tenant/branch/state เดิม

| ผู้ใช้ | สิ่งที่ต้องเกิด |
| --- | --- |
| System admin | เห็นสวิตช์พร้อมคำอธิบายตรงขอบเขต เปลี่ยน ON/OFF ได้ผ่าน command/version/audit เดิม |
| พนักงานผู้สร้าง | OFF แล้วไม่เห็นทางเข้า manual ใหม่ แต่ยังแก้ draft ของตนและส่งตรวจได้ตามสิทธิ์ |
| Reviewer / finance | งานตรวจ ยืนยัน จ่าย ลบ หรือหลักฐานเดิมไม่ถูก manual-entry flag ตัดสิทธิ์ |
| ผู้ใช้ LINE | สิทธิ์ capture/continuation/correction ไม่ขึ้นกับการแสดงทางเข้าเว็บนี้ |
| Read-only / ผู้ข้ามบริษัทหรือสาขา | การเปิดสวิตช์ไม่เพิ่มสิทธิ์ ไม่ทำให้เข้าถึงข้อมูลที่เดิมห้าม |

Journey หลัก: admin เปิดหน้าบริษัท → แพ็กเกจและฟีเจอร์ → ค่าใช้จ่ายและใบเสร็จ → เปิดฟีเจอร์บันทึกด้วยมือเดิมไว้ → ปิด switch ย่อย “แสดงทางเข้าบันทึกด้วยมือบนเว็บ” → ผู้ใช้รับ session ล่าสุด → ทางเข้า manual หาย → upload/review ทำต่อได้ → เปิดกลับ → ทางเข้าเดิมกลับมาเฉพาะผู้มีสิทธิ์

## 3. Current-state findings ที่ต้องปิด

| ID | ประเภท | หลักฐาน/ปัญหาปัจจุบัน | Target |
| --- | --- | --- | --- |
| F01 | Wrong control for this goal | key เดิม OFF ตัด create/update; E2E ยืนยัน 9 บทบาทได้รับผล | เพิ่ม key ใหม่ permissionKeys ว่าง; คง key เดิม |
| F02 | Separate backend bug | UI/use case อนุญาต `expense.delete` แต่ DELETE controller ต้องมี `expense.update` | HTTP guard ตรงกับ delete use case; ownership/state ยังตรวจด้านใน |
| F03 | Separate backend bug | LINE ส่ง `line-draft:...`; draft validator อนุญาตเฉพาะ `[A-Za-z0-9_-]{8,64}` | ใช้ deterministic key ที่ผ่าน validator โดยไม่ขยาย payment-key regex |
| F04 | Integration gap | `entitledFeatureKeys` มีใน resolver แต่ตกหล่นก่อน `/auth/me` และ WebSession | ส่งข้อมูลเดิมต่อถึงเว็บอย่างชัดเจน ไม่สร้าง permission ปลอม |
| F05 | Refresh gap | Access fingerprint มี roles/permissions/scopes เท่านั้น; flag เปลี่ยนโดย permissions เท่าเดิมจะไม่ refresh | Include normalized feature snapshot และแยก feature-only change จากการถอนสิทธิ์ |
| F06 | Entry coverage | ลิงก์ manual กระจายที่ sidebar, list, ledger, guide, AI guidance, tax return path | ทุกลิงก์ใช้ predicate เดียวกัน; direct URL มี dedicated entry gate |
| F07 | Preset impact | `applyPreset` ไม่อ่าน state เดิม จึงเปิด manual กลับได้ | รักษาค่า manual ที่มีอยู่เมื่อใช้ preset ในบริษัทเดิม |
| F08 | Confirmed baseline behavior | E2E ปิด key เดิมแล้ว focus refresh ทำให้ formCount=0 และข้อมูลที่ยังไม่บันทึกหาย | ปิดเฉพาะ admission ใหม่; mounted form ที่ได้รับ admission แล้วไม่หายเพราะ flag-only change |
| F09 | Test gap | Unit LINE mock `createDraft.execute` จึงไม่เจอ F03 | Integration ต่อ real note use case กับ real create use case |

Audit แยก observed behavior, design requirement และสิ่งที่ยังไม่ได้ทดสอบไว้ในเอกสารหลักฐาน ห้ามใช้ baseline tests ที่ผ่านเป็นหลักฐานว่า target behavior implement แล้ว

## 4. Truth table ของ switch ย่อยใหม่

ตารางนี้ตรึง `expenses=true` และ `expenses.manual=true` ไว้ การเปลี่ยน switch ย่อยต้องไม่แก้สองค่านี้

ทุกช่อง “ตามเดิม” หมายถึงยังต้องผ่าน company active, membership, role permission, tenant/branch, source state และกติกาเฉพาะ flow

| เส้นทาง/การกระทำ | entry ON | entry OFF |
| --- | --- | --- |
| Sidebar/ปุ่ม/ลิงก์เข้า `/expenses/manual` | แสดงเมื่อมี `expense.create` และ parent เปิด | ซ่อน |
| เข้า URL manual ใหม่ / reload / เปิดแท็บใหม่ | รับเข้าเมื่อข้อมูล availability พร้อมและ role อนุญาต | แสดง unavailable state ไม่ mount ฟอร์มใหม่ |
| ฟอร์ม manual ที่รับเข้ามาก่อน OFF | ทำต่อได้ | ทำต่อได้; ห้ามล้าง input/file/idempotency key จาก flag อย่างเดียว |
| POST `/expenses` โดยผู้มี `expense.create` | ตามเดิม | ตามเดิม |
| สร้างรายการใหม่ในใบรับรองแทนใบเสร็จ | ตามเดิม | ตามเดิม |
| แก้ draft เดิมทุก capture source / ส่งตรวจ / เริ่มตรวจใหม่ | ตามเดิม | ตามเดิม |
| Upload, OCR ไม่พร้อม/เกิน quota, กรอกผล OCR เอง | ตามเดิม | ตามเดิม |
| LINE text/media/continuation/edit preview/apply | ตามเดิม | ตามเดิม |
| Capture group/review/allocation/handoff | ตามเดิม | ตามเดิม |
| ใบเบิกจ่ายและ expense projections | ตามเดิม | ตามเดิม |
| Confirm/payment/void/ledger/tax/export/report | ตามเดิม | ตามเดิม |

Parent `expenses=false` หรือ launch gate `expenses/DEFAULT=CLOSED` ยังใช้ semantics เดิมของมัน ห้ามทำให้ parent เปิดอัตโนมัติเพียงเพราะเว็บมี `expense.create` จาก stale session

## 5. Data model และ permission contract

### 5.1 Flat storage, สวิตช์ย่อยใน UI

- เพิ่ม key **`expenses.manual.web_entry`** ใน catalog/approved entitlement keys ใช้ `CompanyFeatureEntitlement` และ command เดิม ไม่เพิ่ม table, migration, env flag, SKU หรือ permission
- Smallest fit: เพิ่ม leaf definition ใน `FEATURE_CATALOG` ของ `expenses`, `permissionKeys: []`, route `/expenses/manual`; admin render leaf นี้เป็น setting ใต้แถว `expenses.manual` ไม่เป็นเมนูธุรกิจอีกแถว
- Catalog ปัจจุบันมีเพียง top-level + flat submenus; `parentFeatureKey(key)` คืน segment แรก จึงยังคืน `expenses` แม้ชื่อใหม่มีสาม segment ห้ามอ้างว่ามี recursive inheritance อยู่แล้ว และไม่ต้องสร้าง recursive feature engine
- ความเป็น “ใต้ manual” ใน UI และ effective entry ใช้การตรวจทั้งสาม key อย่างชัดเจน (§6); ไม่ต้องเพิ่ม commercial dependency/cascade rule เพื่อให้ preference ของทางเข้าอยู่ได้ขณะ feature เดิม OFF
- อย่าเพิ่ม navigation item, route หรือ sidebar node ซ้ำเพราะ catalog leaf ใหม่ ใช้ manual route/node เดิม
- Explicit new-row `false` ต้องคงอยู่; missing new row ให้ inherit ON ตาม existing submenu default เพื่อรักษาพฤติกรรมบริษัทเดิม; legacy zero rows ยังคืน null
- ฟีเจอร์เดิม/parent OFF มีผลตามเดิมแม้ stored entry=true; ON ตัวใหม่ไม่เปิด parent/ฟีเจอร์เดิม/permission ให้เอง
- Onboarding/package materialization ต้องไม่เผลอเขียน explicit false เพราะ key ใหม่ไม่อยู่ใน hardcoded preset; default entry=true เมื่อไม่มี prior choice แต่ manual authority ยังคง gate ตามเดิม
- ไม่ backfill หรือเรียก normalizer เพื่อเปลี่ยนค่าลูกค้าระหว่างงานนี้ การ bootstrap row เมื่อ admin บันทึกครั้งแรกต้องใช้ command/CAS/audit ปกติ

### 5.2 Authority invariance

**ห้ามแก้ `expenses.manual.permissionKeys`**, `pack.expense.self`, HTTP expense guards หรือ backend source-state conditions ในงาน switch นี้ Key ใหม่ไม่มี permission owner, ไม่มี pack, ไม่มี guard ที่ repository/use case/LINE tools

เมื่อ parent/manual เดิม/roles/scopes เท่าเดิม:

```text
permissions(entry=true) == permissions(entry=false) == permissions(entry=true again)
```

ต้องเทียบ permission ทั้งชุดสำหรับ OWNER/ADMIN/STAFF/FINANCE/ACCOUNTANT/custom/read-only ไม่ใช่ดูแค่ expense.create หากปิด key เดิมหรือ parent การถอน permission ตาม implementation เดิมยังเกิดได้และไม่ใช่หน้าที่ switch ใหม่นี้ที่จะยกเว้น

Catalog tests ต้องตรวจ key ใหม่เพียงหนึ่งตัวและไม่มี owned permission; ไม่ลด invariant ของรายการอื่นเพื่อให้ผ่าน

## 6. Session contract: API → web

### 6.1 ใช้ข้อมูลที่มีอยู่แล้ว

`ResolvedAccess.entitledFeatureKeys?: string[] | null` มีอยู่ใน resolver และ repository คืนค่าแล้ว ให้ forward ผ่าน:

1. `ResolveRequestContextUseCase` → API `RequestContext`
2. shared contracts `RequestContext` ให้ตรงกับ API model
3. `GET /v1/auth/me` → `entitledFeatureKeys`
4. web `WebSession`, `MyContext`, `fetchServerSession` และ `fetchMyContext`

External `/auth/me` ใน production path ต้องคืน `entitledFeatureKeys` เสมอ ไม่จำเป็นต้องทำ field นี้ mandatory สำหรับ internal/system test contexts ทุกตัว แต่ห้ามแปลง missing field เป็น legacy `null` โดยปริยาย

ตัวอย่าง response เพิ่มแบบ additive:

```json
{
  "companyId": "company-A",
  "permissions": ["expense.create", "expense.update", "expense.receipt.upload"],
  "entitledFeatureKeys": ["expenses", "expenses.manual", "expenses.upload", "expenses.list"]
}
```

กรณีนี้ entry OFF (ไม่มี `expenses.manual.web_entry`) ขณะที่ฟีเจอร์ manual เดิมยัง ON และ permissions คงเดิม

| ค่า | ความหมายฝั่งเว็บ |
| --- | --- |
| array | ใช้ snapshot จาก server; ตรวจทั้ง `expenses`, `expenses.manual`, `expenses.manual.web_entry` |
| `null` | บริษัท legacy ไม่มี entitlement rows; inherit allow แต่ยังต้องมี `expense.create` |
| field หาย / malformed / initial request error | unknown; ไม่รับเข้า manual ใหม่ แสดง retry; ไม่ปิด feature อื่น |

ห้ามให้ browser ส่ง feature list มาเพิ่มสิทธิ์ API และไม่เก็บ feature decision ใน localStorage/JWT เป็น authority

### 6.2 Predicate เดียวสำหรับทางเข้า

เพิ่ม helper เล็กใน web expense feature เช่น `manual-expense-entry.logic.ts` ใช้ร่วมกันโดย nav/CTA/dedicated gate:

```text
manualWebEntryAvailable =
  entitledFeatureKeys === null
  OR (array contains expenses AND expenses.manual AND expenses.manual.web_entry)

canOpenManualWeb = session is for the active company
  AND permissions contains expense.create
  AND manualWebEntryAvailable
```

unknown availability แยกจาก disabled เพื่อแสดง loading/error/retry ได้ถูกต้อง ห้ามใช้ `permissions.includes('expense.create')` เพียงอย่างเดียวแทน predicate นี้

ไม่เปลี่ยนความหมาย `expenseCapabilities.canCreate` เพราะ wizard และ flow อื่นยังต้องใช้ authority เดิม ให้ส่งค่า entry availability แยกจาก capabilities

### 6.3 Revalidation และ company switching

- เพิ่ม snapshot ของ entitled features ใน `accessContextFingerprint` โดย sort/deduplicate โดยไม่ mutate input; `null`, missing และ empty array ต้องไม่ถูกเหมารวม
- ใช้ focus/visibility/`ACCESS_CONTEXT_STALE_EVENT`/poll **60 วินาที** เดิม ไม่เพิ่ม timer หรือ websocket
- feature-only change ต้องอัปเดตทางเข้าแม้ permission array ไม่เปลี่ยน; role/scope revoke ยังใช้ error/refresh เดิม
- company switch ต้อง reset entry admission; ห้ามนำ snapshot/admission ของบริษัท A ไปใช้บริษัท B
- loading/failed reads ห้ามทำให้เมนู manual กระพริบเปิดก่อนทราบค่า
- ไม่มีคำรับรองว่าปิดสวิตช์แล้วหายทุกแท็บทันที: fresh page ใช้ fresh context; แท็บเปิดอยู่ปรับเมื่อ revalidate สำเร็จ

## 7. Dedicated manual-page admission และการรักษางานค้าง

### 7.1 เข้าหน้าใหม่

- server route `/expenses/manual` โหลด session ของบริษัทด้วย `fetchServerSession` แบบ no-store เดิม
- ใช้ client entry gate ที่มี props จาก server และ revalidate เมื่อเป็น stale/back-navigation ก่อนรับเข้าใหม่; ไม่อาศัยเมนูซ่อนอย่างเดียว
- ส่ง manual links ด้วย `prefetch={false}` ถ้า prefetch ทำให้ client ใช้ผล admission เก่า; มี test Back/Forward และ stale route cache
- gate ต้องครอบเฉพาะ `ManualExpensePanel` ไม่ครอบทั้ง `ExpensesHubPage` หรือทุก `/expenses/*`
- alias `/expenses?tab=manual`, deep link และ tax-setup return ต้องลงที่ gate เดียวกัน ไม่มีช่องเปิดผ่าน query string
- generic `canAccessWorkspacePath` เป็น permission gate ของโมดูลตามเดิม ไม่ใช้ `expenses.manual.web_entry` ปิด module shell หรือไล่ผู้ใช้ไป dashboard

### 7.2 Form ที่เปิดอยู่แล้ว

Admission เป็นสถานะในหน่วยความจำของ mounted page/user/company เท่านั้น:

- เมื่อ admission สำเร็จแล้ว flag-only OFF ไม่ unmount form, ไม่เคลียร์ branch/items/tax/file และไม่สร้าง idempotency key ใหม่
- ผู้ใช้บันทึกรายการที่กำลังกรอกได้ตาม API permission เดิม และแนบไฟล์หลังสร้างต่อได้
- แสดงข้อความสุภาพได้ว่า “ปิดทางเข้าบันทึกด้วยมือแล้ว คุณยังบันทึกรายการที่กำลังกรอกได้”
- เมื่อออกจากหน้า, hard reload, เปลี่ยนบริษัท/ผู้ใช้ หรือเปิดแท็บใหม่ ต้องประเมิน admission ใหม่
- permission/company/session ถูกถอนจริงยังมีผล ห้ามใช้ admission bypass API authorization
- รูปแบบ component ต้องคง client gate identity ระหว่าง `router.refresh`; server ไม่สลับทั้ง subtree เป็น forbidden เพราะ flag-only change จนทำข้อมูลที่กรอกหาย
- ไม่เพิ่ม persistent draft store, ไม่ส่งข้อมูลไป server อัตโนมัติ และไม่เพิ่มสิทธิ์ให้ผู้ไม่มี role grant

Acceptance ต้องทดสอบกรอกข้อมูล+เลือกไฟล์ → OFF จากอีก admin session → focus/poll → form อยู่ → บันทึกครั้งเดียว → เปิด URL ใหม่ไม่ได้

## 8. Admin UI และข้อความ

แสดงโครงสร้างดังนี้ โดย switch หลักคง label และ semantics เดิม:

```text
ค่าใช้จ่ายและใบเสร็จ
  บันทึกด้วยมือ                         [switch เดิม]
    แสดงทางเข้าบันทึกด้วยมือบนเว็บ       [switch ใหม่]
```

คำอธิบาย switch ใหม่: “ปิดเพื่อซ่อนเมนูและปุ่มเข้าหน้าบันทึกด้วยมือบนเว็บ งานที่เปิดอยู่ การแก้รายการเดิม อัปโหลดใบเสร็จ LINE และใบรับรองแทนใบเสร็จยังใช้สิทธิ์เดิม”

- Parent/manual เดิม OFF: setting ใหม่แสดงค่าที่เก็บไว้พร้อม disabled และข้อความให้เปิดฟีเจอร์เดิมก่อน; ไม่เปลี่ยน stored preference
- Preview/save ระบุเปลี่ยนเฉพาะ “ทางเข้าบนเว็บ”; ไม่แสดงเป็นการถอน create/update หรือซื้อแพ็กเกจใหม่
- Entry unavailable: “บริษัทปิดทางเข้าบันทึกด้วยมือบนเว็บอยู่” พร้อมทางกลับรายการ/อัปโหลดที่ actor มีสิทธิ์
- Unknown/read error: “ยังตรวจสอบการเปิดใช้งานหน้านี้ไม่ได้ กรุณาลองอีกครั้ง” พร้อม retry; role deny ใช้ permission state เดิม
- Loading/save/conflict/normalization/inactive-company controls ใช้ pattern เดิม Switch มี accessible name, focus และ aria-checked; hidden CTA ไม่เหลือ keyboard focus target

## 9. ครอบคลุม web entry ทุกจุด

| จุด | พฤติกรรมที่ต้อง implement/verify |
| --- | --- |
| Sidebar desktop/mobile (`buildNavItems`) | Manual submenu ใช้ canOpenManualWeb; siblings ไม่หาย |
| Expense list (`ExpenseListPage`) | “บันทึกเอง” ซ่อนเมื่อ OFF |
| Dedicated route / hub tab | ใช้ admission §7; `canCreate` ยังเป็น authority เดิม |
| Income-expense ledger | CTA manual/empty-state ใช้ helper; upload ยังเสนอได้ |
| User guide | ไม่แสดง actionable manual link เมื่อ OFF; ข้อความอธิบายทั่วไปเก็บได้ |
| AI usage guidance บนเว็บ | ไม่เสนอ `expenses/manual` ที่เปิดไม่ได้; guidance อื่นเดิม |
| Tax-code setup return link | ลิงก์กลับไป manual ต้องผ่าน gate; กลับ existing expense ไม่ถูกเปลี่ยน |
| Upload “ไม่มีเอกสาร” | ทางเข้า wizard เดิมคงไว้; อย่านำ manual web flag ไปครอบ `caps.canCreate` |
| SubstituteReceiptWizardPage | การสร้าง/เลือก existing expense คง permission/state เดิมทั้งหมด |
| Notifications/bookmarks/query aliases | ถ้า URL ปลายทางคือ dedicated manual ให้ใช้ gate; record detail ไม่ถูก gate |

ใช้ server session ส่ง field/derived availability ตาม prop chain ที่มีอยู่ ไม่เพิ่ม global auth framework หรือ query ต่อ CTA แต่ละตัว

## 10. Preset / billing / parent transitions

1. Preset ของบริษัทเดิมต้อง preserve **ค่าปัจจุบันของ key ใหม่** รวม unsaved pending choice ทั้ง true/false; ไม่ใช่อ่านเฉพาะ server snapshot
2. ไม่แก้ preset semantics ของ `expenses.manual` หรือ feature อื่นเพื่อทำงานนี้
3. Parent/manual เดิม OFF ทำให้ effective entry ปิด แต่ไม่ overwrite stored entry preference; เปิดกลับต้องได้ preference เดิม
4. `applyPreset`, toggle-all/group/menu และ admin preview ต้องไม่ reset key ใหม่หรือสร้าง second menu row
5. Billing renewal/package conversion ต้องรักษา new-key explicit admin override ผ่าน infrastructure `adminOverrideKeys` เดิม; missing key default ตาม §5, ไม่เป็น SKU เพิ่ม
6. ทดสอบ existing explicit false/true, pending false/true, absent row, new onboarding และ legacy first save แยกกัน
7. `commandId`, expectedSetVersion, same-command replay, payload conflict, audit และ normalization gate เดิมต้องทำงานสำหรับ key ใหม่เหมือน approved key อื่น

## 11. Separate follow-up A — Delete permission mismatch

**ไม่อยู่ใน implementation ของ switch ใหม่** เก็บวิธีแก้และ test boundary ไว้สำหรับงานแก้บั๊กแยก; ไม่ทำให้ backend behavior เปลี่ยนปนกับงาน visibility

Controller `DELETE /companies/:companyId/expenses/:expenseId` เปลี่ยนจาก `RequirePermissions('expense.update')` เป็น `RequireAnyPermission('expense.delete', 'expense.update')`

Use case ยังคงตัดสิน:

- `expense.delete` สำหรับผู้มี authority ลบตาม scope
- หรือ `expense.update` สำหรับ draft ของตนเองเท่านั้น
- state ที่ลบได้, paid/confirmed/posted locks, linked documents, retention, tenant/branch, duplicate refresh, attachments และ audit อยู่ครบ

ห้ามเปลี่ยน controller เป็น delete-only เพราะจะตัดเส้นทางเจ้าของลบ own draft และห้ามให้ update-only ลบของคนอื่น

Test ต้องใช้ actual decorated controller + `DenyByDefaultGuard` และ actual delete use case เพื่อไม่ให้ mock ข้าม mismatch อีก รวม role finance ที่มี delete แต่ไม่มี update ทั้ง flag ON/OFF

## 12. Separate follow-up B — LINE draft idempotency contract

**ไม่อยู่ใน implementation ของ switch ใหม่** E2E integration ปัจจุบันได้ 400 ทั้ง ON/OFF ของ key เดิม ต้องระบุ known failure นี้ตรงไปตรงมา ไม่อ้างว่างาน switch ใหม่แก้ LINE แล้ว

### 12.1 Root cause และวิธีแก้ที่เลือก

`CaptureLineExpenseNoteUseCase` สร้าง key `line-draft:${eventId}` แต่ `CreateExpenseDraftUseCase` ใช้ `PAYMENT_IDEMPOTENCY_KEY_PATTERN` ที่ไม่รับ `:` จึง fail ก่อนสร้าง draft ทั้ง manual ON/OFF

เลือกแก้ฝั่งสร้าง key ให้เป็น **hex SHA-256 64 ตัวอักษร** จาก tuple คงที่ เช่น JSON array `["line-expense-note-v1", companyId, stableEventIdentity]` ใช้ `node:crypto` ที่มีอยู่ ไม่เพิ่ม dependency และไม่ขยาย validator ของ payment/expense create

- stableEventIdentity ใช้ original webhook event id; fallback lineMessageId เฉพาะเส้นทางที่ไม่มี event id จริง ๆ และต้องคง fallback เดิมตลอด replay
- ห้ามใช้ current requestId, timestamp, retry count หรือ random UUID สำหรับ LINE event replay
- ไม่ใส่ raw message text, access token หรือ chat secret ใน key/audit
- deterministic hash ช่วยเรื่องรูปแบบ key เท่านั้น; tenant/owner/branch/chat checks, payload fingerprint, unique key และ transaction ยังต้องอยู่

### 12.2 Compatibility / lost response

- completed historical captures ต้องยังถูกพบโดย `findByLineMessageId`; ไม่สร้าง record ใหม่เพราะ key algorithm เปลี่ยน
- เพิ่ม fixture legacy `line-draft:...` ที่มี line provenance แล้ว; replay ต้องคืนตัวเดิมตาม scope
- ตรวจ orphan/retry boundary ที่ draft สร้างแล้วแต่การติด line provenance ยังไม่สำเร็จ: ถ้า predecessor build สามารถมี legacy key จริง ให้มี targeted read-only lookup ของ legacy key ใน company/owner/branch เดียวกันก่อนเริ่ม hash key ใหม่ โดยใช้ payload identity เดิม; ห้ามย้าย/ลบ historical row หรืออนุญาต caller เลือก key เอง
- หากไม่มีหลักฐาน predecessor path ที่ persist key เดิมได้ ให้บันทึก code/history evidence ใน memory ก่อนตัด compatibility lookup ออก; อย่าเดาว่าไม่มีข้อมูลจาก validator ของ HEAD อย่างเดียว
- การ retry/hash key เดิมที่ payload ต่างต้อง 409 ตามเดิม; same event ไม่เกิด orphan/duplicate expense, lines, number, audit success หรือ outbox event ซ้ำ
- ห้ามแก้บั๊กนี้ด้วยการ mock create use case ใน test acceptance

## 13. Neighbor module boundaries

| Module | Boundary / acceptance |
| --- | --- |
| Employee access / resolver | entry OFF ไม่เปลี่ยน permissions; parent OFF ยังตัด; role access matrix ไม่แสดงว่า revoke create/update |
| Auth / web session | field additive, tenant-specific, unknown ≠ legacy, auth/privacy guards เดิม |
| LINE gateway/AgentCore | ไม่เปลี่ยน prompts/tools เพื่อซ่อนหรือปฏิเสธ create/edit เพราะ new web entry OFF; gateway ไม่เข้าถึง repositories |
| LINE edit/correction | `expense.update` เดิมทำให้ preview/apply/edit hints คงเดิม; existing LINE draft-edit rollout flag ยังมีผล |
| Receipt OCR / quotas | OCR off/failed/quota-full ยังแก้ draft ที่ upload แล้วเองได้; ไม่พาไป dead manual CTA |
| Capture group / handoff | ตรวจ create/file/review/handoff/auto-handoff เมื่อมี upload/review permission; derived source identity และ evidence locks เดิม |
| Substitute certificate/signatures | การสร้าง manual expense ภายใน wizard, signed versions, payer/evidence ownership และ linked source state เดิม |
| Reimbursements | claim draft/approve/payout/materialize API_INTERNAL projections ไม่พึ่งทางเข้าเว็บ; ห้ามเพิ่ม gate ที่ shared repository จนปิด projections |
| Payments / ledger / tax | ไม่มี schema/account/amount/VAT/numbering change จาก flag; confirmation และ side effects เดิม |
| Vendor/category setup | update/create vendor, tax selections, branches และ supplier details ไม่ถูก entry predicate ครอบ |
| Dashboard/notifications/report/export | existing sources/counts/links/read authority เดิม; ห้ามกรอง records ที่ captureSource=WEB_MANUAL เพราะ flag OFF |
| Billing / admin presets | เคารพ stored/manual choices ตาม §10; entitlement command ยัง atomic และ audited |

## 14. State, concurrency, audit และข้อจำกัดที่ตั้งใจ

- ไม่มี ExpenseRecord state transition จากการสลับ flag ไม่มี archive/delete/reclassify/re-number/backfill
- ใช้ entitlement command CAS และ replay เดิม: stale admin save ต้อง 409, same commandId/same payload replay ได้, reused key/different payload conflict
- ไม่เพิ่ม transaction lock หรือ backend final-mutation fence ให้ `expenses.manual.web_entry` เพราะ scope นี้ควบคุมทางเข้าเว็บ ไม่ได้ห้าม backend creation
- Flag OFF แข่งกับ request ที่ส่งไปแล้ว: API ทำตาม permission/parent/launch gate เดิมได้ ถือว่า expected; ไม่สัญญา “zero new expense หลัง cutoff”
- การปิด parent หรือ revoke role เป็นคนละ authority ต้องไม่ถูก entry admission ยกเว้นให้
- audit admin เก็บ company/key/from/to/admin/command ตามเดิม; UI availability checks ไม่สร้าง business mutation audit ปลอม
- F02/F03 ต้องคง audit behavior เดิมของ use case ไม่เปลี่ยน result FAILED/DENIED/SUCCESS ให้ปิดบังผลจริง

## 15. Compatibility และ rollout

ไม่มี Prisma migration, permission migration หรือการเปลี่ยน semantics key เดิม เพิ่ม catalog key + additive session field + UI admission เท่านั้น

1. เตรียม API ที่รู้จัก key ใหม่, ส่ง feature snapshot และรักษา permission mapping เดิม
2. เตรียม web consumers/nav/predicate/fingerprint/admission และ admin child control
3. เปิดให้ admin เปลี่ยน key ใหม่หลัง serving web ทุก instance รองรับแล้ว; old web จะไม่รู้จัก entry flag และอาจยังแสดงเมนู
4. New web + old API ที่ไม่มี snapshot: unknown state ปิด admission ใหม่พร้อม retry ไม่สรุปว่า legacy null; verify version skew ก่อน release
5. Stored flag/role/expense data เดิมต้องไม่ถูกเปลี่ยนจาก deployment; บริษัทที่ปิด `expenses.manual` เดิมไม่ถูกเปิดสิทธิ์กลับ
6. Rollback web เก่าอาจแสดง manual entry กลับเพราะไม่อ่าน key ใหม่ แต่ไม่มี permission expansion จากการ rollback mapping (mapping เดิมไม่ถูกแก้ตั้งแต่แรก); เก็บ new-key row ไว้และบันทึก visibility limitation

ก่อน cloud inspection อ่าน [cloud operations](../runbooks/cloud-environment-operations.md); ก่อน deploy/promotion/customer-gate change/retry อ่าน [mandatory deployment protocol](../runbooks/uat-production-v2-deployment.md) งานนี้ไม่อนุญาต deploy หรือเปลี่ยน customer flag

## 16. Acceptance criteria

| ID | เงื่อนไขผ่าน |
| --- | --- |
| AC01 | key ใหม่เป็น approved leaf แสดงใต้ manual; key/mapping/stored values เดิมไม่เปลี่ยน; toggle ใหม่ไม่แก้ feature อื่น |
| AC02 | effective permissions ทุก key เท่าเดิมเมื่อ entry ON→OFF→ON; parent OFF ยังมีผล |
| AC03 | `/auth/me` ส่ง `entitledFeatureKeys` ถูก company ทั้ง array/null; missing ไม่ถูกตีความเป็น null |
| AC04 | sidebar/mobile/list/ledger/guide/AI guidance ไม่มี actionable manual entry เมื่อ OFF |
| AC05 | direct URL, query alias, back/forward, tax-return ผ่าน admission เดียวกัน; OFF ไม่เปิดฟอร์มใหม่ |
| AC06 | admitted form ยังอยู่หลัง feature-only refresh และบันทึกครั้งเดียวได้; reload หลัง OFF ปิด admission |
| AC07 | fingerprint เปลี่ยนเมื่อ flag เปลี่ยนแม้ permissions เท่าเดิม; sort order อย่างเดียวไม่ทำ refresh loop |
| AC08 | company switch/membership revoke ไม่ reuse admission หรือ snapshot ข้ามบริษัท/ผู้ใช้ |
| AC09 | direct API create ยังทำงานตาม `expense.create` เมื่อ entry OFF; no-permission/cross-tenant/cross-branch ยังคง deny |
| AC10 | upload/OCR-failed/quota-full review และ own draft update/mark-ready/restart ยังทำได้ตามเดิม |
| AC11 | substitute wizard create/select-existing/sign/review และ reimbursement projection ไม่ถูกปิด |
| AC12 | key ใหม่ ON/OFF ไม่เปลี่ยน LINE capture permission/path/result; known F03 บันทึกแยก ไม่ใช้ stub ปิดบัง และไม่อ้างว่า create สำเร็จ |
| AC13 | web create retry/lost response หลัง entry OFF ยัง recover command เดิมโดยไม่สร้างซ้ำ; LINE F03 retry evidence แยกจากงานสวิตช์ |
| AC14 | LINE preview/apply/correction และ edit-capability response คงเดิมเมื่อเปลี่ยน web entry flag |
| AC15 | key ใหม่ไม่เปลี่ยน DELETE authority/status; existing delete-only mismatch F02 เป็น follow-up แยก; state/tenant/retention guards เดิมคงอยู่ |
| AC16 | capture group/handoff และ ledger/tax/report/export regression ไม่เปลี่ยนผลจาก flag |
| AC17 | preset รักษาค่า entry ปัจจุบัน; billing รักษา explicit override; parent/manual ON ไม่ reset entry OFF |
| AC18 | loading/disabled/error/retry/keyboard/mobile ครบ; ไม่มี blank redirect loop หรือ copy ว่า backend ถูกปิด |
| AC19 | admin stale CAS/idempotent retry/normalization/inactive-company controls ผ่าน |
| AC20 | target tests ใช้ key ใหม่บน candidate จริง; old-key simulation ไม่ถูกนับเป็น acceptance ของ v2; F02/F03 และ baseline UI failures ระบุแยก |

## 17. Out of scope และ definition of done

ไม่สร้าง global kill switch, ไม่หยุด LINE/manual API, ไม่ปิด wizard, ไม่เพิ่ม permission/SKU/table, ไม่ปรับเงิน/ภาษี, ไม่เปลี่ยน parent launch/runoff policy และไม่แก้ปัญหา unrelated ใน dirty working tree

งานสวิตช์ไม่รวม follow-up หลังบ้าน §11–12 และไม่เปลี่ยนความหมาย `expenses.manual` เดิม

Implementation complete เมื่อ AC01–AC20 มีหลักฐานตาม plan, spec/plan/memory อัปเดตสถานะจริง และระบุ live evidence ที่ยังค้างอย่างตรงไปตรงมา การจบ **งานเอกสารรอบนี้** หมายถึงเอกสารพร้อมใช้งานเท่านั้น
