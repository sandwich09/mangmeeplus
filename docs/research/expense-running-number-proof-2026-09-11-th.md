# ผลพิสูจน์ flow เลขรายจ่ายและเอกสารที่ผูกกัน

> Historical audit before implementation. Latest implementation and local evidence: [verification report](../qa/evidence/expense-running-number-implementation-2026-09-11/README.md). Waiting-state/failure statements below describe that baseline.

วันที่: 2026-09-11
สถานะ: ตรวจบน local clone แล้ว; spec รอพัฒนา; **ยังไม่ผ่าน full browser/ledger/new-feature acceptance**
Spec: [expense-running-number-flowaccount-spec-th.md](../specs/expense-running-number-flowaccount-spec-th.md)
หลักฐาน: [README และ logs](../qa/evidence/expense-running-number-2026-09-11/README.md)

## คำตอบที่พิสูจน์ได้

ไม่ควรรับรองว่าไม่มีเส้นทางติดทั้งหมด ระบบเดิมเดินเส้นทาง API หลักและย้อนกลับได้ แต่มีข้อจำกัดผู้สำรองจ่าย ข้อผิดพลาดเมื่อ retry กลับรายการ และ E2E ที่ยังไม่พิสูจน์ผ่าน เลข EXP ตั้งแต่ร่างยังไม่มี implementation

ผลที่สำคัญกว่าจำนวน test คือ request เดียวเดินจาก source receipt ไปถึงจ่าย/กลับรายการ/ยกเลิกได้จริงโดยไม่สร้างการจ่ายต้นทางซ้ำ อย่างไรก็ตาม flow นี้ใช้การตัดสินใจและเงินผ่าน API ไม่ใช่คลิกหน้าเว็บครบทุกขั้น และไม่ได้รัน worker ลงสมุดบัญชีจน posted

## สภาพแวดล้อมและการแยกขอบเขต

- Source worktree `/tmp/mangmee-substitute-editable-navigation-20260910`, HEAD `a3bfed76309a207d242b9aa27bc6b11b4f9077e4`; root checkout เก่ากว่าในบางส่วนและมีงานอื่นค้างจำนวนมาก จึงไม่ใช้เป็น baseline ทดสอบ
- API ใช้ compiled review artifact ที่มีอยู่ใน worktree; เก็บ SHA-256 ของ entrypoint ใน manifest เป็น local investigation ไม่ใช่ clean release build หรือ Production acceptance
- ใช้ Docker PostgreSQL local ที่ port 15432 โคลน `reimbursement_source_review` เป็น **`expense_number_proof_20260911`** ด้วย pg_dump/pg_restore ไม่แก้ฐานต้นฉบับ
- API 3011 / web 3012 / Redis DB14 แยกจาก review servers เดิม สร้าง synthetic source IDs `qa-exp-number-proof-*` และไฟล์ MinIO ชื่อเฉพาะงานนี้
- Clone ขาด migration baseline สองรายการ `20260910110000_substitute_receipt_editable_draft_facts` และ `20260910120000_substitute_receipt_revision_lineage`; ใช้ prisma migrate deploy บน clone เท่านั้น แล้วรัน PG ซ้ำ
- ไม่เขียน EXP migration ไม่ backfill ข้อมูลผู้ใช้ ไม่เปลี่ยน source code ของ product, package.json, customer gates, cloud, merge หรือ deploy

## ผลทดสอบ แยกตามระดับหลักฐาน

| กลุ่ม | ผล | สิ่งที่พิสูจน์ / ข้อจำกัด |
| --- | --- | --- |
| Expense edit PostgreSQL | 31 ผ่าน | ข้อมูลเดิม/no-op, แก้ก่อนออก, revision/scan, paid/posted/issued locks, ข้ามเดือนและ concurrency ของ SRC; ไม่ใช่ EXP policy ใหม่ |
| Substitute funding PostgreSQL | 7 ผ่าน | digital/paper issue ครั้งเดียว, COMPANY/PERSONAL_ADVANCE, เก็บข้อเท็จจริงเดิม; setup บางสถานะใช้ seed โดยตรง |
| RB race/source PostgreSQL | 16 ผ่าน | submit/edit/cancel/approval race, duplicate source, frozen facts/files, materialize และ payout; กรณี confirm มี mock allocator/audit ไม่ใช่ full application |
| Document sequence branch collision | 6 ผ่าน | logic/repository mock ไม่ใช่ PostgreSQL concurrency |
| Legacy reimbursement compatibility migration | 3 ผ่าน | zero-line backfill, รักษา one/many-line, trigger rollback, idempotence และ old/current writer bridge; ไม่ใช่ migration ของเลข EXP |
| API linked journey | เดินถึง void สำเร็จ; strict retry assertion ไม่ผ่าน | pay ซ้ำสำเร็จเดิม แต่ void ซ้ำ 422; ดูรายการ API ด้านล่าง |
| API recovery verification | ผ่าน 1 probe หลังแก้ probe ให้ GET detail | cancel เกิดสำเร็จก่อนแล้ว; rerun ตรวจ state/links สุดท้ายจาก GET ไม่ได้นับว่า cancel ถูกทำซ้ำอีกครั้ง |
| Browser baseline ที่ไม่แก้ tests เดิม | 2 ผ่าน / 8 ไม่ผ่าน | ไม่มีสิทธิ์ประกาศ UI E2E green; แยกปัญหาด้านล่าง |
| Renderer + snapshot hash probes | reproduce ได้ทั้งคู่ | SRC หายเมื่อมี EXP ใน paper SVG และเติม field เข้า retained snapshot ทำ approval hash เปลี่ยน; ทั้งสอง probe ไม่เขียน DB |

จำนวน PostgreSQL จริงรวม **57** อีก **6** เป็น mock/logic รวม suite log 60 + migration 3 ไม่ควรเรียกทั้งหมดว่า real-DB tests ส่วน 48/146 baseline tests จาก audit ก่อนหน้าไม่ได้ใช้แทนหลักฐาน end-to-end รอบนี้

## เส้นทาง API จริงที่บันทึกได้

Fixture source `qa-exp-number-proof-reversal3`: ใบเสร็จร้านสมมติ 100 บาท มี cost lines 60 + 40, วันที่เอกสาร 22 ส.ค. 2026, ผู้สำรองจ่าย Local Owner, branch สยาม สร้าง initial source ผ่าน seed บน clone จากนั้นใช้ permission-checked APIs จริงทั้งหมด

ทดสอบด้วย requester Owner และ approver MANAGER ตาม role ที่ตรึงตอน submit; การเงิน/จ่ายใช้ Owner ที่มีสิทธิ์ ปรับ policy ของบริษัทบน clone ชั่วคราวและ restore ค่าใน finally

| ขั้น | ผลจริง |
| --- | --- |
| เลือก source → create draft → submit | 200/201; ได้ `RB-202609-00003` |
| แก้ source ขณะส่ง RB | 409 `substitute_source_has_live_claim`; ไม่บันทึกชื่อร้านที่พยายามเปลี่ยน |
| MANAGER reject → requester reopen | 200; กลับ DRAFT และคง RB เดิม |
| แก้เหตุผล → resubmit → approve | 200; FINANCE_REVIEW |
| Finance NEEDS_INFO | 200; กลับ DRAFT โดยคง RB เดิม |
| resubmit → approve → finance approve | 200; READY_FOR_PAYMENT; มี projection หนึ่งรายการ |
| pay 100 → retry ด้วย key เดิม | 201 ทั้งสองครั้ง; payment เดียว |
| void payout | 200; READY_FOR_PAYMENT / UNPAID |
| retry void เดิม | **422 `Payment is already voided`**; strict probe fail ที่นี่ |
| GET ยืนยันว่า payment VOIDED แล้ว cancel | 200; CANCELLED |
| ตรวจ DB/GET สุดท้าย | RB เดิม, source ยัง NEEDS_REVIEW/paid 0/EXP null; projection VOIDED/paid 0; ReimbursementPayment VOIDED หนึ่งแถว; ExpensePayment บน source+projection รวม 0 |

Projection จริงคือ `cmtwiaba90037dnk1xl36t8xh`, EXP `EXP-202609-00001` ทั้งที่ source expenseDate เป็น ส.ค. เป็นหลักฐานของ current confirmation-month behavior การย้ายไป draft/document-month ต้องแก้ confirm และ materializer ไม่ใช่แค่ปุ่มสร้างร่าง

ก่อนยกเลิก postingStatus ยัง `pending`; หลัง cancel เป็น `not_required` **ไม่ได้พิสูจน์ journal posted → reversal ในงวดเปิด/ปิด** และไม่ได้พิสูจน์ cancellation หลาย projection ที่ล้มกลางทางผ่าน API จริง

Probe recovery ครั้งแรกใช้ mutation summary เป็น detail จึง assert `lines` ไม่ได้หลัง cancel สำเร็จแล้ว แก้เฉพาะ probe ให้ GET detail และตรวจ DB ซ้ำ ผลสำเร็จสุดท้ายไม่ลบข้อเท็จจริงว่า void retry ยัง 422

## ช่องว่างที่ต้องลง spec

| ID | ระดับหลักฐาน | ข้อสรุปและสิ่งที่ต้องทำ |
| --- | --- | --- |
| B01 | API + DB จริง | เดือน EXP ปัจจุบันมาจาก confirm ไม่ใช่วันเอกสาร; source ยังไม่มี EXP ตั้งแต่ร่าง ต้องทำ N01–N09 |
| B02 | real renderer | paper SVG ใช้ EXP แทน SRC ในช่องเดียวเมื่อ EXP มีค่า ต้องแสดงเลขสองประเภทแยกกันและตรวจ PDF จริง |
| B03 | real hash function กับ snapshot จาก fixture จริง | เติม `expenseNumber` เข้า source snapshot v1 ทำ hash จาก `8e19ad98e7d01e739bd7c66d2115ba93` เป็น `ce2924e0889d8324351729b6aea8b7d8`; ห้าม rewrite retained snapshot เพื่อ backfill display reference |
| B04 | API จริง | void ซ้ำเป็น 422; ต้องมี idempotent outcome หรือ client reconcile จาก GET ให้ผู้ใช้ทำต่อได้ ไม่ใช่ reversal ซ้ำ |
| B05 | PG จริง | paper PERSONAL_ADVANCE ที่ไม่มี payerUserId ถูกปฏิเสธ `reimbursement_source_payer_unlinked`; เป็นข้อจำกัดขอบเขตที่ต้องบอกก่อนเริ่มทำ ไม่ใช่เดาผู้รับเงินย้อนหลัง |
| B06 | PG/API จริง | source locks และ wrong approver rejection ทำงาน เป็นข้อจำกัดที่ต้องรักษา UI ต้องบอก RB/ผู้ทำต่อได้ตามสิทธิ์ |
| B07 | E2E runner จริง | test suite เดิมยังไม่เป็น release evidence; ต้องซ่อม harness และพิสูจน์ browser ทุกเส้นทางหลัง feature ใหม่ |
| B08 | ยังไม่มี implementation | EXP migration, rollback target, old browser/worker, signed-history usability และ full posted-ledger flow ยังเป็น acceptance เปิดอยู่ |

## ทำไม browser baseline ยังไม่ผ่าน

รัน tests เดิม 10 กรณีใน Chromium worker เดียว:

- REIMB list render และ empty-lines validation ผ่าน 2
- REIMB create/submit, multi-line และ pay 3 กรณี ส่ง GET policy response กลับ PUT ทั้งก้อน มี id/companyId/timestamps และ fields นอก DTO จึง 400 ก่อนเริ่ม business flow เป็น **test contract gap** ไม่ได้พิสูจน์ว่าผู้ใช้สร้างใบเบิกไม่ได้
- Digital/Paper editable navigation 2 กรณีถูก `feature_temporarily_unavailable` ที่สร้างรายจ่ายใหม่ Clone มี launch authority ผูก build เก่า แต่ proof runtime ตั้ง GIT_SHA ของ baseline ไม่ได้เปิด/แก้ customer gate เพื่อข้ามข้อจำกัดนี้ เป็น **environment prerequisite**; ยังไม่พิสูจน์ผ่านหน้าฟอร์ม
- Cancelled/view digital/paper 2 กรณีค้าง loading ไม่มี navigation เป้าหมาย; date-picker อีก 1 กรณีไม่พบปุ่มวันนี้หลังคลิก รวม 3 ต้องหาสาเหตุต่อก่อนใช้ suite รับงาน
- Web เริ่มต้น Turbopack resolve symlink dependency นอก worktree ไม่ได้ เปลี่ยนเฉพาะคำสั่ง local runner เป็น webpack จึงเปิดหน้าได้ แต่ browser loading ข้างต้นยังไม่หาย; trace มี HMR handshake failures ยังไม่สรุปว่าเป็น product bug เดียวกัน
- Linked UI probe แยกก็หยุดรอปุ่มแก้ไขหลัง API reopen จึงรัน API-only probe ต่อโดยไม่อ้างว่า UI ผ่าน

เก็บ raw traces ไว้ใน `/tmp/expense-number-proof-*results` สำหรับตรวจบนเครื่อง ไม่รวม session/network artifacts เหล่านั้นในเอกสารที่ส่งต่อ

## L01–L16: ขอบเขตที่พิสูจน์แล้วและที่ยังต้องรัน

คำว่า partial หมายถึงผ่านระดับที่ระบุเท่านั้น ไม่ใช่ผ่านทั้ง acceptance row

| Case | หลักฐานรอบนี้ | คงค้าง |
| --- | --- | --- |
| L01 ย้อนดู | partial PG no-op | Browser 3→2→1 และ EXP↔SRC↔RB จริงยังไม่ผ่าน |
| L02 ย้อนแก้ก่อนออก | partial PG edit/revision | UI/save/new EXP same-number assertions |
| L03 RB draft source stale | partial PG refresh | UI preserving user fields/unlink selection |
| L04 Submitted source lock | PG + API denial และตรวจ no mutation | permission-aware RB link ใน UI |
| L05 Reject/NEEDS_INFO/resubmit | API ผ่าน คง RB | signed history retrieval และ UI หลัง migrate |
| L06 Unlink/เปลี่ยน source | ยังไม่รัน end-to-end | rollback/cancel edit/attachments/source-owned fields |
| L07 Materialize/retry | PG + API หนึ่ง projection | หลายเดือน/หลายบรรทัด/EXP ตั้งแต่ร่าง/response loss ที่ finance |
| L08 Cancel projections | API หนึ่ง projection ผ่าน | หลาย projection + injected partial failure + posted reversal |
| L09 Pay/void/retry | pay retry ผ่าน, void retry 422, GET recovery/cancel ผ่าน | UX reconcile และ real journal reversal |
| L10 SRC correction/locks | partial PG funding/edit/state | browser cancelled/active RB และ document-history access |
| L11 งวดปิด | ยังไม่รัน real posted-ledger E2E | เปิด/ปิดงวดและสิทธิ์การแก้/กลับรายการ |
| L12 คิวเก่าหลัง migrate | พิสูจน์ hash hazard | EXP migration และ version-compatible approval/pay |
| L13 browser/worker เก่า | ยังไม่รัน | cutover compatibility และ no overwrite |
| L14 rollback/replay | migration bridge เดิม 3 ผ่าน | EXP migration/rollback rehearsal จริง |
| L15 paper payer | PG ปฏิเสธ unlinked ตามกฎ | นโยบายผู้ไม่มีบัญชีและ UI เส้นทางที่ประกาศรองรับ |
| L16 ค้น/สิทธิ์/โมดูล OFF | partial wrong actor/tenant/branch guards | search/export/reverse links และ expenses OFF + reimbursement ON จริง |

## ข้อสรุปเพื่อรับงานรอบพัฒนา

มีหลักฐานเพียงพอให้ลง spec และเริ่มแก้จากจุดที่ระบุได้ แต่ยังไม่พอประกาศว่าไม่มีทางตันหรือ migration/E2E พร้อมเปิดใช้ ต้องปิด B01–B08 ตาม scope และ acceptance ใน spec ก่อนรับ implementation ไม่มีการแก้ product หรือ merge ในงานพิสูจน์นี้
