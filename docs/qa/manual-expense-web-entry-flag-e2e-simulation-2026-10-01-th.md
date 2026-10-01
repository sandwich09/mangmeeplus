# Local E2E simulation: manual expense web entry

วันที่ 2026-10-01 · Baseline HEAD `4a5817b42` พร้อม existing dirty source · **ไม่มี application implementation change**

## หมายเหตุกำกับ 2026-10-01 (เพิ่มหลังรีวิวอิสระ) — อ่านก่อนใช้เอกสารนี้

เนื้อหาใต้หมายเหตุนี้คงไว้ตามที่เขียนเดิมเพื่อเป็นประวัติ ไม่ได้ถูกแก้ แหล่งอ้างอิงปัจจุบันคือ [spec v3.0](../specs/manual-expense-web-entry-flag-spec-th.md) และ[รีวิวอิสระ](../research/manual-expense-web-entry-flag-review-2026-10-01-th.md)

- **รายงานนี้เป็นหลักฐานของ key เดิมเท่านั้น**: ทุก case สลับ `expenses.manual` ไม่มี case ใดทดสอบสวิตช์ทางเข้าตัวใหม่ ไม่ว่าแบบ v2 หรือ v3.0 จึงห้ามใช้รับรอง acceptance ข้อใดของ spec v3.0
- **ฐานที่รัน**: `4a5817b42` พร้อม dirty source ฐานนี้ **ไม่ใช่บรรพบุรุษของ `origin/develop`** โดย develop (`ae13970b0`) มี commit ที่ฐานนี้ไม่มี 842 รายการ และไฟล์ 3,728 ไฟล์ที่เก็บ hash ไว้ต่างจาก develop 596 ไฟล์ ผู้รีวิวอ่านโค้ดที่ develop แล้วพบว่ากลไกของ key เดิมที่รายงานนี้แสดงยังเหมือนเดิม แต่ไม่ได้รัน E2E ซ้ำ
- **ข้อความที่ไม่เป็นจริงแล้วบน develop**
  1. E09 / F03 และย่อหน้า “PostgreSQL integration ของ LINE note: 4 attempts … 400”: บั๊ก key ของ LINE ถูกแก้ใน `6fddca795` (2026-09-29) ผล 400 ทั้งสี่ครั้งเป็นของฐานเก่า ห้ามใช้เป็นค่าคาดหวัง
  2. คอลัมน์ “ใช้กับ v2 อย่างไร” และตาราง “Coverage ที่ยังต้องทำกับ v2 candidate”: v2 ถูกแทนด้วย v3.0 โดย E07 (ต้อง forward feature snapshot) กลายเป็น boolean ค่าเดียว และ E06 (รักษาค่าของ key ใหม่เมื่อใช้ preset) ไม่เกี่ยวแล้ว เพราะค่าตั้งใหม่ไม่อยู่ในชุดสิทธิ์ รายการที่ต้องทดสอบจริงอยู่ใน plan §5
  3. ข้อความว่าการปิด key เดิม “ไม่ใช่ control ที่เหมาะ” ยังถูกต้อง แต่ข้อสรุปว่าให้เพิ่ม key ใหม่ใน catalog ไม่ใช่แนวทางที่ใช้: D1 ตัดสินแล้ว 2 ต.ค. 2569 (เจ้าของ: ตามที่แนะนำ) ให้สวิตช์เป็นค่าตั้งรายร้าน
- **ข้อจำกัดของหลักฐานที่ผู้รีวิวพบ**
  1. ตารางบทบาทไม่มี HR ซึ่งถือ `expense.create` และ `expense.update` ที่ develop จึงเป็นการยืนยัน 9 จาก 10 บทบาท
  2. ภาพ `admin-preset.png` ถูกถ่ายก่อนหน้าจอวาดเสร็จ หลักฐานที่ใช้ได้ของข้อนั้นคือค่า `manualTurnsOn: 1` ใน `observations-summary.json`
  3. harness ใน `docs/evidence` รันจาก repo ไม่ได้ และยืนยันเป้าหมาย v1 ที่ถูกยกเลิก
- **ที่ตรวจแล้วว่าตรง**: ตัวเลข 72 case, ผ่าน 55, ไม่ผ่าน 17 และการแยกตามชุด ตรงกับ `case-results.json`

[Spec v2](../specs/manual-expense-web-entry-flag-spec-th.md) · [Plan](../plans/manual-expense-web-entry-flag-plan-th.md) · [Audit](../research/manual-expense-web-entry-flag-audit-2026-10-01-th.md) · [Case results](../evidence/manual-expense-web-entry-flag-2026-10-01/case-results.json)

## ข้อสรุปและ owner update

**ปิด `expenses.manual` เดิมได้ แต่กระทบหลังบ้าน จึงไม่ใช่ control ที่เหมาะกับการซ่อนทางเข้าเว็บอย่างเดียว** ผล browser/API/DB ยืนยันว่าตัด create/update, บล็อก direct create/mark-ready/delete, ปิดปุ่มสร้างใน wizard และทำให้ฟอร์มที่เปิดค้างหายหลัง refresh สิทธิ์

ระหว่างทดสอบ owner เลือกแนวทาง **เพิ่ม switch ย่อยใต้ฟีเจอร์บันทึกด้วยมือ ให้เบื้องหลังเหมือนเดิม** Spec v2 จึงกำหนด key ใหม่ `expenses.manual.web_entry` มี permissionKeys ว่าง และ **คง mapping ของ `expenses.manual` เดิม** งาน switch ไม่รวมการแก้บั๊ก LINE/DELETE แยกต่างหาก

การทดลองในรายงานนี้ปิด **OLD key** บน baseline จริงก่อนเปลี่ยนแนวทาง ไม่มี new-key implementation ให้ทดสอบ จึงห้ามใช้ผลนี้รับรอง v2 หรือรายงานว่า new child flag ผ่าน E2E แล้ว

## Environment และขอบเขตการจำลอง

- Snapshot โค้ดปัจจุบันไป `/tmp/manual-flag-e2e-20261001/repo`; ไม่ใช้ clean HEAD แทน dirty code โดยไม่แจ้ง
- Web Next.js 16.3.4 development/webpack `127.0.0.1:3060`; Nest API `127.0.0.1:3061/v1`
- PostgreSQL 18.3 container `manual-flag-e2e-pg-20261001`, port `25463`, database **manual_flag_e2e**; migrate จาก repo และ seed synthetic companies/users เท่านั้น
- Redis container port `26381`; MinIO container port `29003`, versioned bucket **manual-flag-e2e**; upload/download bytes จริง
- Env ถูกสร้างจาก allowlist ไม่โหลด `.env`; LINE/provider credentials ไม่ถูกส่งเข้า process, AI Gateway/email/billing ถูกปิด ไม่ส่งข้อความหรือเรียก OCR provider จริง
- ใช้ auth BFF/cookie/CSRF/legal acceptance และ HTTP bearer fixtures เดิม ทดสอบผ่าน actual controllers, permission resolver, repositories และ database
- Browser Chromium และ WebKit, viewport desktop 1440px/mobile layout 390px; ไม่ใช่ real-device/iOS LINE in-app browser test
- Fixture จำลอง entitlement rows ทุก feature ON แล้ว toggle OLD manual row เฉพาะบริษัททดสอบ; admin command case ใช้ synthetic COMPLETED/EXPLICIT normalization marker เพื่อเข้าเงื่อนไข command เดิม
- ส่วนใหญ่ toggle ผ่าน fixture SQL เพื่อแยกตัวแปร; อีก case ทดสอบ PUT admin command จริงพร้อม replay/CAS ไม่อ้างว่า fixture SQL เป็น production change protocol
- ไม่แตะ services ของงานอื่นที่ `3000/3001` หรือ DB port `25461`; ไม่อ่าน cloud/UAT/Production และไม่เปลี่ยน customer flag

## ผลรวมที่นับหลังแก้ test harness

**72 case/browser variants: 55 ผ่าน, 15 ไม่ตรง target v1 เดิม, 2 baseline UI assertions ไม่ตรงหน้าจอปัจจุบัน** ไม่มี case ที่ซ่อนด้วย skip ในชุดที่นับนี้

| ชุด | Valid cases | ผ่าน | ไม่ผ่าน | ความหมาย |
| --- | ---: | ---: | ---: | --- |
| Main simulation | 33 | 22 | 11 | API 10 roles, entry/routes, upload, admitted form, admin command |
| Extended simulation | 9 | 7 | 2 | Wizard, new tab/restore/auth, multi-file, reviewer/tenant, missing feature snapshot |
| Focused recheck + extra cases | 3 | 1 | 2 | Preset, reviewer confirm, lost-response retry after OFF |
| OFF adjacent regression | 7 | 7 | 0 | LINE source-draft browser editing + reimbursement flow |
| ON baseline regression รวม selector recheck | 14 | 12 | 2 | Expense CRUD/receipt/OCR fallback/numbering/retry |
| WebKit desktop/mobile | 6 | 6 | 0 | Manual ON save, OFF URL/alias, OFF upload |
| **รวม** | **72** | **55** | **17** | 15 = old-key behavior vs superseded v1; 2 = baseline UI expectation gap |

เพิ่ม PostgreSQL integration ของ LINE note: **4 attempts** (ON/OFF × first/retry) ได้ `400 Invalid draft idempotency key` ทั้งหมด และจำนวน ExpenseRecord ไม่เพิ่ม ใช้ actual Nest DI, real permission resolver, real CaptureLineExpenseNoteUseCase/CreateExpenseDraftUseCase และ DB ไม่ stub create ตัวที่มีปัญหา ไม่รวม 4 attempts นี้เป็น browser case ที่ผ่าน

Counting: pilot ที่แก้ selector/fixture แล้วไม่นับ; main wizard timeout ใช้ selectorผิดถูกแทนด้วย extended ON/OFF ที่แก้แล้ว; extended admin timeout ใช้ผิด view ถูกแทนด้วย recheck `?view=package`; EXP-01/09 selector ambiguous ถูกแทนด้วย recheck ที่เจาะ status chip การแก้ทั้งหมดอยู่ใน snapshot/test harness เท่านั้น ไม่แก้ repo test เดิม

## Role matrix: OLD manual ON → OFF

บันทึก response status จริงจาก [observations](../evidence/manual-expense-web-entry-flag-2026-10-01/observations-summary.json) ไม่ใช้เพียงปุ่มใน UI

| Actor | POST create | Own WEB_UPLOAD generic edit | Review-fields | Mark-ready | DELETE own fresh DRAFT |
| --- | --- | --- | --- | --- | --- |
| OWNER, ADMIN, MANAGER, FINANCE | 201 → 403 | 200 → 200 | 200 → 200 | 201 → 403 | 204 → 403 |
| STAFF, ACCOUNTANT, SALES, INVENTORY, MARKETING | 201 → 403 | 200 → 403 | 403 → 403 | 201 → 403 | 204 → 403 |
| COMPANY_VIEW | 403 → 403 | ไม่มี create fixture | ไม่มี create fixture | ไม่มี create fixture | ไม่มี create fixture |

- 9 roles ที่สร้างได้เสีย `expense.create` และ `expense.update`; permission/read-only negative ยัง deny ตามเดิม
- Expense list read ยังทำงาน; unknown tenant และ staff ที่เรียกบริษัทอื่นจริงถูก 403
- Parent expenses OFF ยังตัด authority; company A OFF ไม่ตัด company B; ON กลับใช้ token/session เดิมสร้างได้
- ผู้มี review ยังใช้ PATCH/reviewer-mark-ready และยืนยันรายการพร้อมไฟล์หลักฐานได้ภายใต้ OLD OFF; **อย่าสรุปว่าแก้ draft ทั้งหมดพัง**
- LINE source-only editing เป็นอีก path: browser ของ synthetic upload-only actor แก้ชื่อผู้ขายและเพิ่มรายการที่ OCR อ่านไม่ได้ได้ โดยไม่รับ finance authority ทั้งสอง case ผ่านเมื่อ OLD OFF

## Findings ที่มีหลักฐาน runtime

| ID | ผลที่เกิดจริง | ใช้กับ v2 อย่างไร |
| --- | --- | --- |
| E01 / F01 | OLD OFF ตัด business permissions และ POST/mark-ready/DELETE ตามตาราง | คง old flag และเพิ่ม empty-permission entry flag แยก ห้าม reuse old switch เพื่อซ่อนเมนู |
| E02 / F08 | Form เปิดก่อน OFF → submit ได้ 403 `feature_not_enabled`, key `expenses.manual` | New flag ต้องไม่เข้าถึง POST guard; admitted form finish ได้ |
| E03 / F08 | Form มีข้อความ/ราคา → OFF → dispatch focus → auth refresh → formCount=0 | ต้องรักษา mounted admission/state/file/save key หลัง feature-only refresh |
| E04 | Create commit แล้ว response ถูกจำลองให้หาย → OFF → retry ได้ 403; DB มีหนึ่ง record | New key ต้องไม่ขวาง idempotent recovery; ไม่ใช่ duplicate-write bug ในตัวอย่างนี้ |
| E05 | Wizard ON มีปุ่มสร้าง enabled; OFF ปุ่มเดียวกัน disabled | New entry predicate ห้ามไปทับ caps.canCreate/wizard create |
| E06 / F07 | Admin OLD manual OFF → กด starter preset (ยังไม่ save) → manual กลับ ON | Preserve current/pending NEW entry choice โดยไม่เปลี่ยน preset semantics ของ old feature |
| E07 / F04 | `/auth/me` ไม่มี `entitledFeatureKeys` | ต้อง forward snapshot เพื่อให้ frontend อ่าน new flag แยกจาก permissions |
| E08 / F02 | DELETE controller ต้อง update แม้ delete permission ยังอยู่ | Separate backend mismatch; new flag must not make it worse, ไม่รวมแก้ใน entry diff |
| E09 / F03 | LINE note composed PG integration fail 400 ทั้ง ON/OFF/retry; ไม่มี insert | Separate existing bug; UI switch ไม่ได้แก้ LINE key |

ภาพประกอบ:

- [ฟอร์มหายหลัง focus refresh](../evidence/manual-expense-web-entry-flag-2026-10-01/screenshots/focus-refresh-off.png)
- [บันทึกฟอร์มเปิดค้างถูกปฏิเสธ](../evidence/manual-expense-web-entry-flag-2026-10-01/screenshots/active-submit-off.png)
- [Wizard เมื่อ old flag OFF](../evidence/manual-expense-web-entry-flag-2026-10-01/screenshots/wizard-false.png)
- [Preset เปิด old manual กลับ](../evidence/manual-expense-web-entry-flag-2026-10-01/screenshots/admin-preset.png)
- [Retry หลัง response หาย](../evidence/manual-expense-web-entry-flag-2026-10-01/screenshots/lost-response-off.png)
- [อัปโหลด PNG+PDF เมื่อ OFF](../evidence/manual-expense-web-entry-flag-2026-10-01/screenshots/multi-upload-off.png)

## สิ่งที่ผ่านจริงและระดับของหลักฐาน

| Flow | หลักฐาน |
| --- | --- |
| Manual ON | Browser กรอก/บันทึก, อ่าน API ตรวจ description/amount, reload ยังคงค่า ทั้งสอง engines และสอง widths |
| Manual OFF entry | Direct URL และ `?tab=manual` ไม่มี form/manual links, tab ใหม่ของ session เดิมถูกปิด; unauthenticated ไป login |
| Navigation | OFF ตรวจ /expenses, /expenses/upload, /income-expense-ledger, /user-guide/expenses, /ai-suggestions, /expenses/substitute-receipts, /reimbursements, /expenses/categories, /expenses/signatures, /expenses/evidence ไม่มี manual link และไม่เกิด client exception ที่จับได้ |
| Restore ON | Focus refresh เห็นลิงก์อีกครั้งและเปิด manual ได้โดยไม่ login ใหม่ |
| Upload | UI → signed MinIO upload → complete → expense detail; attachment/captureSource อ่านกลับจาก API ทั้ง engines/widths; multi-file PNG+PDF ได้สอง draft |
| OCR fallback/receipt | ON baseline upload/download/extraction-unconfigured, edited totals/confirm ผ่าน; ไม่อ้างคุณภาพ OCR provider |
| Reviewer OFF | Review evidence → reviewer-mark-ready → confirm → read-back CONFIRMED ผ่าน |
| Source draft LINE OFF | Synthetic LINE receipt + upload-only actor: edit vendor, add unreadable item, reload/read DB, ไม่มีปุ่มยืนยันบัญชี |
| Reimbursement OFF | List, create→submit, multiline total, empty-line reject, manager approve→finance review→cash payout PAID ผ่าน |
| Numbering/retry ON | Real commit lost response, retry command เดิมได้ ID เดิม; upload staging/date review/correction ไม่เปลี่ยนเลขที่ออกแล้ว |
| Admin | Real OFF command200, same-command replay200, stale setVersion409, ON command200; runtime permission คืนหลัง ON |

Route checks คือการเปิดหน้าและตรวจ entry/client errors ไม่ใช่ full journey ของทุก module; reimbursement assertions ยืนยัน PAID/API state แต่ไม่ได้ตรวจทุก accounting projection/tax event ด้วย SQL

## Baseline test gaps ที่ไม่เกี่ยวกับการปิด flag

1. **EXP-02** คาด summary labels “ค่าใช้จ่ายรวม”, “ภาษีซื้อ (VAT)”, “ค้างจ่าย”, “เกินกำหนดชำระ”; หน้า list ปัจจุบันไม่มี label แรกตาม selector ทดสอบจึง fail แม้ ON ไม่อ้างว่าเป็น flag regression และยังไม่ตัดสิน product requirement แทนเจ้าของ
2. **EXP-04** คาด “ยอดก่อนหักส่วนลด” ในหน้า detail แต่ UI ปัจจุบันไม่มีข้อความตาม selector ทดสอบจึงหยุดก่อนเดินครบตาม test เดิม ไม่ลด assertion เพื่อทำให้ green
3. EXP-01/09 ใช้ `/ยืนยันแล้ว/` จับทั้งปุ่ม export และ status chip แก้เฉพาะ snapshot test เป็น `/^ยืนยันแล้ว(?:\s+\d+)?$/` แล้วทั้งคู่ผ่าน เป็น harness ambiguity ไม่ใช่ product bug

## Coverage ที่ยังต้องทำกับ v2 candidate

ไม่มี application code ของ new flag จึง **ยังไม่มี AC01–AC20 ของ v2 ที่รับรองครบ** ตารางนี้แสดงขอบเขตของ baseline evidence เท่านั้น:

| ขอบเขต | สถานะ |
| --- | --- |
| New approved key + permissions invariant + absent/default compatibility | ต้องทดสอบหลัง implement; old-key matrix เป็นเหตุผลให้แยก key |
| New field array/null/unknown และ feature-only fingerprint | ยังไม่ implement; ยืนยัน baseline field missing แล้ว |
| Direct URL/alias/desktop/mobile/new tab | baseline ทดสอบแล้ว; new-key gate ต้องรันใหม่ |
| Back/Forward BFCache, tax-return, stale prefetch, company/membership revoke, version skew | ยังไม่ได้ browser E2E ในรอบนี้ |
| Admitted form/input/file/idempotency after new flag OFF | baseline text-loss/403/retry reproduced; new-key success ต้องรันใหม่ รวม pending file |
| LINE preview/apply/correction, long event, altered payload, historical legacy orphan | ยังไม่ได้ full provider/PG matrix รอบนี้; LINE note failure กับ source-only edit เป็นคนละ path |
| Quota full, real OCR/AI/LINE webhook + reply | ไม่รัน provider/live; unconfigured OCR และ synthetic LINE source เท่านั้น |
| Substitute digital/paper signing/retention/cancelled revisions | ตรวจ wizard create control และ existing list; ไม่ได้ full signature journey |
| Capture group split/handoff allocation และทุก ledger/tax/export/report | ตรวจ ordinary image/PDF intake และ finance subset; ไม่ได้ครบทุก state/financial invariant |
| Billing renew/new-key override, onboarding, normalization lifecycle, inactive company, admin altered-payload reuse | ยังไม่ได้ new-key E2E; command replay/stale CAS baseline ผ่าน |
| Real iOS/Android/LINE browser/accessibility audit/English locale | Chromium/WebKit viewport tests เท่านั้น |

## Reproduce และ artifacts

[Harness/setup notes](../evidence/manual-expense-web-entry-flag-2026-10-01/README.md) มีไฟล์ diagnostic tests และคำสั่ง ผล raw JSON และย่อ observations เก็บใน docs/evidence; raw traces/full HTML/logs อยู่ที่ `/tmp/manual-flag-e2e-20261001/evidence` (temporary, ไม่ใช่ durable release artifact)

ใช้ source hash manifest ใน evidence เพื่อระบุ dirty baseline ที่ทดสอบ ห้ามนำ server หรือ scripts ไปชี้ customer environment Test suite ตั้ง localhost/DB-name/port guards และจงใจมี assertions ที่แดงตามผลกระทบ old switch

หลัง simulation: update spec/plan/memory ตาม owner decision v2; ยังไม่ implement, ไม่แก้ original application/test/package files, ไม่ deploy และไม่เปลี่ยน flag จริง ต่อมา owner อนุญาตให้ commit/push/merge เฉพาะเอกสารและหลักฐานของงานนี้เข้า main และ develop
