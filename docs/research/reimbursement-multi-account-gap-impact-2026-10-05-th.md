# Audit: บัญชีรับเงินคืนหลายบัญชี — bug, gap, impact และ scenario

> **หมายเหตุผู้ควบคุมงาน 2026-10-05:** การตรวจนี้อ่าน working tree ที่ยังไม่มีฟีเจอร์บัญชีรับเงินคืน (#962/#963) ข้อ F01, F03–F05, F07, F11, F13, F14 จึงมีอยู่ในระบบแล้ว ผลเทียบกับโค้ดปัจจุบันทีละข้ออยู่ใน [สเปกฉบับปรับตามระบบจริง §2.3](../specs/reimbursement-multi-payout-accounts-spec-th.md) ตารางกรณีทดสอบยังใช้เป็นรายการอ้างอิงได้

วันที่: 2026-10-05
ขอบเขตหลักฐาน: อ่าน docs/schema/contracts/use cases/repository/web/tests ใน local working tree ซึ่งมีงานอื่นค้างอยู่; ไม่ใช่การตรวจระบบที่ deploy และไม่ได้ใช้ข้อมูลธนาคารจริง
สถานะ: ออกแบบและตรวจ static เสร็จ พร้อม baseline tests; ฟีเจอร์ใหม่ยังไม่ implement

[Spec ที่ใช้ตัดสิน](../specs/reimbursement-recipient-bank-account-spec-th.md) · [แผน](../plans/reimbursement-recipient-bank-account-plan-th.md) · [memory](../agent-memory/reimbursement-recipient-bank-account.md)

ผู้ใช้ยืนยัน: หลายบัญชีในรอบแรก ผู้เบิกเลือกต่อใบ และรองรับบัญชีบุคคลอื่นเมื่อผู้อนุมัติตรวจและยอมรับ คำชี้แจงเพิ่มเติม: ผู้รับคืน/เจ้าของบัญชีเป็นคนนอกบริษัทที่ไม่มีผู้ใช้ในระบบได้ A เป็นผู้ยื่นและเลือกเอง B ไม่ต้องสมัครหรือยืนยัน การตรวจบัญชีเป็นงานของคนตามข้อสรุปเดิม

## ข้อสรุปจาก code trace

ยังไม่มี recipient account feature ใน reimbursement schema/contract จึงไม่เรียกทุกข้อที่ขาดว่า regression ที่เกิดขึ้นแล้ว การเติม dropdown อย่างเดียวจะเหลือช่องโหว่ที่ submit/approve/pay/sign และเส้นทางทำใบแทน โดยเฉพาะเมื่อเปลี่ยน master account หลังส่งใบ

แยกหลักฐานเป็น **G = feature gap ที่ยืนยันจากโครงสร้างปัจจุบัน**, **B = guard ที่ขาดใน code path ปัจจุบันจาก static review**, **R = ความเสี่ยงที่ต้องพิสูจน์เมื่อ implement** ระดับ P1 คือเสี่ยงจ่ายผิด/ซ้ำ/ข้อมูลส่วนตัวรั่ว/เอกสารรับรองผิด ต้องปิดก่อน release; P2 คือความครบ UX/operations/integration ห้ามถือว่าทดสอบผ่านแล้วเพียงมีแถวในตาราง

## Findings และการปิด gap

| ID | ประเภท/ระดับ | สิ่งที่พบและ trigger | ผลกระทบ | แบบแก้/หลักฐานอ้างอิง |
|---|---|---|---|---|
| F01 | G/P1 | create/update/submit/payment ไม่มี recipient contract; schema ไม่มี account wallet/snapshot | ไม่รู้ว่าใบนี้พนักงานเลือกบัญชีใด | เพิ่ม saved accounts + per-request/per-payment snapshot; E1, E2 |
| F02 | G/P1 | Finance สร้าง แก้ และส่งแทนได้ หาก reuse permission เดิมกับ field ใหม่จะเลือกบัญชีแทนพนักงานได้ | ไม่ตรงเป้าหมาย/เงินไปผิดผู้รับ | แยก field authorization + claimant confirmation hash; E3 |
| F03 | G/P1 | approval/claim-signature hash ยังไม่มี bank destination | อนุมัติ A แต่จ่าย B หรือเซ็นเนื้อหาเดิมแล้วใช้บัญชีใหม่ | versioned hash ของ financial facts และ third-party acceptance; E4 |
| F04 | G/P1 | PaymentForm เริ่ม CASH และเปลี่ยน method ได้เอง | ใบต้องการโอนแต่บันทึกเงินสด/วิธีอื่นเพื่อผ่าน guard | freeze requested method ตั้งแต่ส่ง; ใช้ correction เมื่อเปลี่ยน; E5 |
| F05 | G/P1 | paid replay ใน use case และ repository เทียบยอด/currency/method/ref/source bank แต่ไม่มี recipient | retry หลังเปลี่ยนปลายทางอาจคืน payment ที่ไม่ตรง | bind execution/version/hash ทั้งสอง replay branches; E6 |
| F06 | G/P1 | request/payment locks กัน record ซ้ำ แต่ยังไม่มี ownership ก่อนออกไปโอนจริง | คนสองคนโอนก่อนที่คนแรกกดบันทึก | execution ownership + unknown-outcome hold; E6 |
| F07 | G/P1 | reopen จำกัด REJECTED/PENDING_APPROVAL; finance NEEDS_INFO ปฏิเสธ live projection/recorded payment | ใบพร้อมจ่ายบัญชีผิดไม่มี generic return ที่ใช้ได้ | cancel/reissue ตาม guarded projection cleanup; ไม่เพิ่ม READY→DRAFT; E3, E7 |
| F08 | B/P1 | scan acknowledgement ตรวจ requestNo; repository link ไม่ล็อก/ตรวจ request content hash | เปิดใบเดิมแล้ว content เปลี่ยนก่อนแนบ อาจรับรอง scan ที่ไม่ใช่ฉบับปัจจุบัน | เพิ่ม expected hash + request lock และ revision history; static guard gap ยังไม่ได้ทดสอบ race จริง; E8 |
| F09 | B/P1 | record payment รับ `currency` จาก input แล้วส่งลง DB; validatePaymentRecording ไม่มี request/payment currency comparison | payload ต่าง currency แต่ตัวเลขเท่ากันอาจ mark claim paid ผิดสกุล | assert equality ทั้ง use case/repository ก่อน write และ replay; static finding ยังไม่ได้ยิง API/DB จริง; E6, E4 |
| F10 | B/P1 | `bankAccountId` เป็น optional string; ไม่พบ tenant/active/source-account lookup ใน record path ที่ตรวจ | source bank อ้างบัญชีผิด tenant/บัญชีใช้ไม่ได้; อย่านำ field นี้มาเป็น recipient | ตรวจ BankAccount บริษัท/สิทธิ์/สถานะเมื่อส่ง ID; แยก recipient ID; static finding ยังไม่ได้ยิง API จริง; E1, E6 |
| F11 | G/P1 | ordinary detail/related access/print ไม่มีกติกา sensitive bank read เพราะยังไม่มี field | เพิ่ม plaintext ใน mapper แล้วรั่วทุก path | masked mapper default + exact sensitive-read + print/export/cache guards; E9 |
| F12 | G/P1 | ยอดต่ำกว่า threshold/finance OFF ผ่านไป payment ได้ตามปกติ | THIRD_PARTY ข้ามเงื่อนไข “ผู้อนุมัติยอมรับ” | approval floor ต่อใบ + explicit acceptance ที่ผูก version; SELF ยังใช้ fallback review; E4, E10 |
| F13 | G/P1 | current legacy hash/lines/signature compatibility หลายรุ่น | เปลี่ยน hash ทุกรายทำให้เอกสารเก่าเสีย หรือ fallback ยอมรับใบใหม่ผิด | schema-version dispatch แยก old/new ห้าม backfill verification; E4, E8 |
| F14 | G/P2 | EmployeeAccessProfile เป็น optional ของ CompanyMembership | ถ้าผูก wallet กับ profile เท่านั้น owner/custom role ใช้ไม่ได้ | company membership เป็นเจ้าของรายการ; เงินรับเป็นชื่อบุคคลอื่นได้ตาม acceptance; E2 |
| F15 | G/P1 | spec หลักรวม voucher ตาม requester/payee โดยยังไม่มี destination grouping | ผู้เบิกเดียวมีใบ A/B แต่รวมโอนบัญชีเดียว | amendment grouping company/requester/currency/method/destination; ยังไม่พบ implementation voucher ใน reimbursement paths ที่ตรวจ; E10 |
| F16 | R/P1 | archive/edit master/role removal/สองแท็บ/old client ประจวบกับ submit/pay | selection หาย, stale success, silent bypass, deadlock | versioned account master + immutable snapshots + explicit account/request versions + lock-order tests; E3, E6, E7 |
| F17 | G/P2 | return path บางแห่ง delete signature rows/attachment links | ไฟล์ยังอยู่แต่ history อ้างกลับไม่ได้ครบ | เก็บ invalidated revision evidence ที่ค้นคืนได้; ไม่อ้างว่ามี history สมบูรณ์แล้ว; E7 |
| F18 | R/P1 | void payment ถูกตีความว่าได้เงินคืนจริง หรือโอนสำเร็จแต่ API ล้มเหลวแล้วโอนใหม่ | เงินออกซ้ำ/สถานะปิดผิด | external outcome resolution ก่อนเปิด attempt ใหม่; regression reversal/mirror/reconciliation; E6, E11 |
| F19 | G/P1 | `readReimbursementSource` บังคับ payerUserId=requester และปฏิเสธ certificate payer ไม่มี user; spec เดิม 2026-09-11 เลื่อน external payee ออกนอกระบบ | เพิ่มบัญชีคนนอกได้แต่เบิกต้นทางที่คนนอกสำรองจ่ายจริงยังไม่ได้ | ผู้ใช้ 2026-10-05 เปลี่ยนขอบเขต: requester A แยก external beneficiary B + reviewed source payer binding; ห้ามใช้ A เป็นผู้จ่ายปลอม/ลบ wrong-payer guard ทั้งระบบ; E13 |
| F20 | G/P1 | create UI ใช้ label ผู้รับเงินคืนกับ requester; source/payment/print facts อาศัย requesterDisplayNameSnapshot | ระบบอาจแสดง A เป็นคนรับเงินแทน B หรือรอ B login/เซ็นทั้งที่ไม่มี user | แยก preparer/requester/beneficiary/account-holder; ปรับ projection/report/print/notification/signature semantics; E1, E5, E9, E13 |

F08–F10 เป็นสิ่งที่พบใน code path ปัจจุบัน ไม่ได้พิสูจน์ว่าเคยเกิดกับผู้ใช้จริง แผนต้องเพิ่ม regression ที่ fail ก่อนแก้ ข้ออื่นเป็นสิ่งที่ฟีเจอร์ใหม่ต้องเติม/รักษา ไม่ใช่ข้อกล่าวอ้างว่าระบบปัจจุบันมีบัญชีแล้วแต่ทำงานผิด

## Impact map

| พื้นที่ | ขนาด | เปลี่ยนอะไร | สิ่งที่ต้องรักษา |
|---|---|---|---|
| Prisma/migration/encryption | กลาง | account collection, snapshots, version, confirmation/review/execution facts, indexes/unique | company-member FK, legacy nullable, encryption rotation, retention |
| Contracts/DTO/mapper | สูง | list/mutation/reveal/confirmation/review/pay/scan contract + stable errors | reject forged server fields, masked default, old-reader compatibility |
| Request/approval/finance/payment | สูงสุด | field-level actor, third-party approval floor, locked checks, correction/reissue, external-payment coordination | scope/self-approval/source/projection/duplicate/period rules |
| Web create/journey/queue/settings | กลาง | own account management, selector, third-party reason, proxy handoff, review, payment ownership | mobile/keyboard/error/retry/readonly, no automatic account switching |
| Permission packs/employee lifecycle | กลาง | own-account capability for all eligible member roles | no privilege elevation to others' accounts, role change/frozen assignment rules |
| Print/signature/scan/export/attachments | สูง | revision binding, masked/sensitive output, stale signatures/history | 2/4 signer legacy layouts, paper evidence, not a payment gate |
| Expense/ledger/tax/banking | สูงสำหรับ external payer | source payer binding/version, actual beneficiary projection/reporting, source bank validation/grouping; wallet is separate | amount/currency/sourcePaymentRef/payment mirror/void/reconcile correctness |
| LINE/AI/outbox/audit | กลาง | safe status reasons, actor/version audit | read-only final mutation boundary, no plaintext bank data |
| Rollout/recovery | สูง | pending/unknown-transfer inventory, compatible deployment order and rollback | no retroactive verification, no old writer bypass |

## Scenario matrix

ผลของทุกแถวต่อไปนี้คือ **expected acceptance ยังไม่ run สำหรับ feature ใหม่** ชั้นตรวจ: U=domain/contract unit, A=use-case authorization/API, D=PostgreSQL transaction/integration, W=browser desktop/mobile, O=operational rehearsal ไม่มีการอ้างว่าตารางนี้เป็น exhaustive proof ของทุก interleaving

### บัญชีและการเลือก

| ID | Scenario | ผลที่ต้องได้ | ชั้น |
|---|---|---|---|
| A01 | ไม่มีบัญชีแล้วสร้างใบโอน | เก็บร่างได้ ส่งไม่ได้ มีเพิ่มบัญชีโดยไม่เสีย expense fields | A,W |
| A02 | มีบัญชีเดียว | ต้องเลือก/ยืนยันเอง ไม่มี silent default | U,W |
| A03 | มีหลายบัญชี; ใบแรกเลือก A ใบถัดไป B | แต่ละใบมี snapshot/print/payment ของตน | D,W |
| A04 | เลขท้ายตรงกันต่างธนาคาร/ต่างเลขเต็ม | ตัวเลือกแยกชัด คัดลอกตรงบัญชีที่เลือก | U,W |
| A05 | เลขขึ้นต้น 0, เว้นวรรค/ขีด, paste, อักขระแปลก, เกินขอบเขต | normalize เฉพาะที่อนุญาต ไม่มี Number conversion/ตัดเลขเงียบ | U,W |
| A06 | ชื่อไทย/อังกฤษ/คำนำหน้าต่างจากผู้เบิก | คนตรวจ ไม่ auto-reject/match เป็น ownership proof | U,W |
| A07 | สร้างซ้ำ/retry/network response หาย | unique scoped fingerprint/idempotency คืนรายการเดิม; no duplicate | D,W |
| A08 | คนอื่น/บริษัทอื่นใช้เลขเดียวกัน | ไม่มีข้อมูลเจ้าของอีกคนรั่วผ่าน lookup/error | A,D |
| A09 | แก้ชื่อเรียก/ชื่อเจ้าของ/เลขใน master หรือเพิ่มบัญชีหลังอนุมัติ | ใบเดิม/print/payment ไม่เปลี่ยน | D,W |
| A10 | archive บัญชีที่ draft เลือกไว้ | submit conflict ต้องเลือกใหม่เอง; ไม่ fallback อีกบัญชี | D,W |
| A11 | archive บัญชีที่ส่งแล้ว | แสดงผลต่อใบค้างชัด; snapshot คงเดิม; ถ้าบัญชีใช้ไม่ได้ทำ correction | A,W |
| A12 | เพิ่มบัญชีที่ archived ซ้ำ | ชี้รายการเดิมและให้ยืนยันเปิดใช้ ไม่สร้างรายการแฝง | D,W |
| A13 | เปลี่ยนผู้เบิก/บริษัท/สาขาขณะ fetch ยังไม่เสร็จ | ทิ้ง response เก่า/selection ที่ไม่ตรง scope; ไม่มี cross-context account | A,W |
| A14 | เปลี่ยน BANK_TRANSFER→CASH/CHEQUE/OTHER ในร่าง | ล้าง active recipient; ยืนยันใหม่; historical snapshot ไม่ถูกลบ | U,D,W |
| A15 | เปลี่ยนกลับเป็น BANK_TRANSFER | เลือกบัญชีเองใหม่ ไม่มีค่าค้าง/OTHER bypass | U,W |
| A16 | foreign currency ใหม่/ใบเดิม | new transfer block อย่างมีเหตุผล; ไม่ตีความเลขยอดเป็น THB; legacy read ได้ | U,A,W |

### เจ้าของบัญชี ทำใบแทน และสิทธิ์

| ID | Scenario | ผลที่ต้องได้ | ชั้น |
|---|---|---|---|
| B01 | STAFF/OWNER/ADMIN/custom/read-only company member ไม่มี employee profile | manage/select บัญชีตนได้ตาม self-service pack/entitlement | A,W |
| B02 | Finance ทำใบแทน B | ทำรายการได้; B เป็นคนเลือก/ยืนยัน; finance ไม่เห็น wallet B | A,W |
| B03 | Finance submit ก่อน B ยืนยัน / ปลอม actor confirmation | ปฏิเสธทั้ง API/DTO ไม่ใช่เพียงซ่อนปุ่ม | A,D |
| B04 | B ยืนยันแล้ว finance เปลี่ยนยอด/หลักฐาน/สกุลเงิน | confirmation stale; ต้องให้ B ยืนยันเนื้อหาใหม่ | D,W |
| B05 | draft ไม่เปลี่ยน finance ส่งแทนหลัง B ยืนยัน | ส่งได้ด้วย proof เดิมใน transaction | A,D,W |
| B06 | ส่ง accountId ของคนอื่น/บริษัทอื่น/สมาชิกปิด | ปฏิเสธแบบไม่ leak; ไม่บันทึก snapshot | A,D |
| B07 | ถือ read/read_related/export อย่างเดียว | เห็น masked; reveal/full print/download ไม่ผ่าน | A,W |
| B08 | assigned approver เปลี่ยน role หลังส่ง / ถูกยกเลิก assignment | ใช้ exact frozen authority เฉพาะใบ; ยกเลิกแล้วไม่คงสิทธิ์เลขเต็มลอย ๆ | A,D |
| B09 | เปลี่ยน scope/ปิด membership ระหว่าง session | ตรวจใหม่ทุก mutation/reveal; ใบเก่าไม่ลบ; payment attempt มี takeover path | A,D,O |
| B10 | account ในชื่อบุคคลอื่น | holderType THIRD_PARTY + relationship/reason; approver รับรองปลายทางฉบับนี้ | U,A,W |
| B11 | THIRD_PARTY แต่ยอดต่ำกว่า threshold/finance OFF | มี approval floor; payer-only acknowledgement ไม่แทน approver | U,A,D,W |
| B12 | THIRD_PARTY แต่ missing reason/explicit acceptance | ไม่ submit/approve ตามขั้นที่ขาด; ไม่มี automatic accept จาก review เก่า | U,A,W |
| B13 | ตนเองอนุมัติบัญชีบุคคลอื่น / ร้านคนเดียว | ใช้ self-approval/solo rules เดิมพร้อม explicit acceptance/audit; ไม่สร้างช่องยกเว้นใหม่ | A,D,W |
| B14 | ระบุ SELF แต่ตรวจพบ THIRD_PARTY | reject/return แล้วส่งใหม่; ไม่เปลี่ยนประเภทในขั้นจ่ายเงียบ | A,W |
| B15 | เปลี่ยนชื่อเจ้าของ/holderType/เหตุผลหลังตรวจ | destination/content version ใหม่; confirmation/approval/review เดิมใช้ไม่ได้ | U,D |
| B16 | ลบสมาชิกแล้วเชิญใหม่ด้วย email/ชื่อเดิม | ไม่ได้บัญชีเก่าอัตโนมัติ; recovery ตาม identity เดิม | A,D,O |
| B17 | A เพิ่มบัญชี B คนนอก ไม่มี user/membership | สำเร็จโดยไม่สมัคร/เชิญ B; A เลือกและยืนยันเอง | A,D,W |
| B18 | B สำรองจ่ายจริง A ยื่นคืนให้ | external beneficiary/source payer binding ชัด; approver ยอมรับก่อน payable; ไม่ตั้ง payerUserId=A | A,D,W |
| B19 | A สำรองจ่ายเองแต่เลือกบัญชี B | beneficiary REQUESTER + THIRD_PARTY destination; member source rules คงเดิม | U,A,D |
| B20 | paper/source ไม่มี payerUserId แต่มีข้อมูลคนสำรองจ่าย | external binding ที่คนตรวจทำได้; ไม่ name-match/uploader-match อัตโนมัติ; stale evidence บล็อก | A,D,W |
| B21 | ต้นทางเป็นเงินของสมาชิก C หรือบริษัทจ่ายแล้ว | external mode ไม่ bypass wrong-payer/settled/tax/source guards | A,D |
| B22 | ผสมค่าใช้จ่าย A/B หรือคนนอกชื่อเหมือนกัน | แยกใบตาม beneficiary; ไม่ auto-merge จากชื่อ/เลขบัญชี | U,A,D,W |
| B23 | print/signature/notification/payment report สำหรับคนนอก | ผู้ยื่น A ผู้รับคืน B แยก; ไม่มีงานรอ B login/เซ็น; ไม่ส่งข้อความหาคนนอกเอง | A,D,W |
| B24 | B มาสมัครภายหลัง/เปลี่ยนผู้รับคืนหลังตรวจ/ชื่อบัญชีต่างจาก B | ไม่ auto-link identity; การแก้ beneficiary invalidate snapshot/review; approver ตรวจเหตุผลบัญชีปลายทาง | A,D,W |

### สถานะ การตรวจ และ correction

| ID | Scenario | ผลที่ต้องได้ | ชั้น |
|---|---|---|---|
| C01 | SELF: approval ON/OFF × finance ON/OFF | แต่ละ combination มี human review ก่อนเริ่มจ่าย; ไม่บังคับ 2 คนเพิ่ม | U,A,W |
| C02 | THIRD_PARTY: threshold ON/OFF × finance ON/OFF | ทั้ง 4 combination ต้องผ่าน approver acceptance | U,A,W |
| C03 | reject → reopen → เปลี่ยนบัญชี → resubmit | policy/hash/review ใหม่ ประวัติเหตุผลเดิมอยู่ | D,W |
| C04 | withdraw PENDING แข่ง approve | มีผู้ชนะเดียว; stale หน้าจอ refresh; ห้าม approve snapshot เก่า | D,W |
| C05 | finance NEEDS_INFO ไม่มี projection/payment | กลับ DRAFT ได้ ยืนยัน/ตรวจใหม่ | D,W |
| C06 | READY/APPROVED มี live projection บัญชีผิด | cancel/reissue ตาม guard; ไม่บังคับ reopen ที่ทำไม่ได้ | D,W |
| C07 | cancel cleanup ล้มเหลว/period lock | pending intent ยัง block payment; retry เดิม/owner recovery; ไม่ออกซ้ำ | D,O,W |
| C08 | source ถูกแก้/ยกเลิก/มีใบเบิกอื่นแล้วก่อน reissue | source eligibility/duplicate เดิมบล็อก; ไม่ copy projection เป็น source ซ้ำ | D |
| C09 | DRAFT update/confirm แข่ง submit/archive account | version check และ transaction ให้ outcome เดียว; ไม่ snapshot inactive account | D |
| C10 | approval/review จากสองแท็บคนละ destination hash | stale request ถูกปฏิเสธ; result ไม่ mix version | D,W |
| C11 | ไม่มี approver/เจ้าของเข้าไม่ได้ | routing/recovery เดิม พร้อมอธิบาย block; ไม่ให้ finance เลือกบัญชีแทน | A,W,O |
| C12 | cancelled/voided/paid เปิดจากลิงก์เก่า | readonly ตามสิทธิ์; ไม่ใช้ปุ่ม client เก่าทำ mutation สำเร็จ | A,W |

### จ่ายเงิน retry และความผิดพลาดจริง

| ID | Scenario | ผลที่ต้องได้ | ชั้น |
|---|---|---|---|
| D01 | จ่ายปกติเข้า snapshot ที่ตรวจแล้ว | full amount/currency/method/recipient ตรง; payment snapshot/source facts ถูกต้อง | D,W |
| D02 | ผู้จ่ายสองคนเริ่มพร้อมกัน | หนึ่ง attempt owner; อีกคนเห็นผู้รับผิดชอบก่อนโอน | D,W |
| D03 | ปิด browser/session หมดขณะกำลังจ่าย | hold ไม่หมดเอง; resume/takeover พร้อม audit | D,W,O |
| D04 | ธนาคาร timeout/ผลไม่ทราบ | OUTCOME_UNKNOWN ไม่เริ่ม attempt ใหม่จนตรวจผล | A,D,W,O |
| D05 | ธนาคารปฏิเสธ/บัญชีปิดโดยไม่มีเงินออก | resolve failed พร้อมเหตุผล → correction/retry โดยไม่สร้าง payment | A,D,W |
| D06 | โอนสำเร็จ API save ล้มเหลว/response หาย | retry record key เดิม; ไม่แนะนำโอนซ้ำ; recover payment number ได้ | D,W,O |
| D07 | key เดิมแต่ recipient/method/currency/ref/ยอดต่าง | conflict ทั้ง early replay และ repository | A,D |
| D08 | คนละ key บันทึกใบเดียวพร้อมกัน | payment เดียว ไม่มี liability/mirror ซ้ำ | D |
| D09 | stale pay แข่ง cancel/reopen/เปลี่ยนบัญชี | execution/request locks ปฏิเสธฝ่ายที่ล้าสมัย | D |
| D10 | ยอดเท่ากันแต่ currency ไม่ตรง | ปฏิเสธ before write; เพิ่ม regression สำหรับ F09 | U,A,D |
| D11 | source bank ผิดบริษัท/inactive/ID ปลอม | ปฏิเสธ; recipientId ใช้แทน source bank ไม่ได้ | A,D |
| D12 | เปลี่ยนเป็น CASH/OTHER ใน payment payload | method mismatch ไม่ผ่าน ไม่มี bypass account/review/execution | A,D |
| D13 | โอนผิดบัญชี/ยอด/โอนซ้ำจริงภายนอก | hold + incident/recovery; ไม่บันทึก approved destination เป็นข้อเท็จจริงที่จ่ายผิด | O,W |
| D14 | payment void แล้วเงินยังไม่ได้คืน/ผลคืนไม่ทราบ | ยังไม่เปิดโอนใหม่อัตโนมัติ; reconcile/period guard คงอยู่ | D,O |
| D15 | partial/split/overpayment | reject ตาม full-payment rule เดิม; legacy PARTIALLY_PAID ไม่ถูกเปลี่ยนเอง | U,A,D |
| D16 | ผู้จ่ายถูกถอดสิทธิ์ระหว่างโอนกับบันทึก | ผู้มีสิทธิ์ takeover เพื่อ reconcile/record ด้วย attempt เดิม; ไม่โอนซ้ำ | A,D,O |

### เอกสาร ความเป็นส่วนตัว integration และ rollout

| ID | Scenario | ผลที่ต้องได้ | ชั้น |
|---|---|---|---|
| E01 | พิมพ์หลัง master เปลี่ยน/archived | ธนาคาร/เจ้าของ/เลขของ snapshot เดิม; default masked | U,W |
| E02 | เซ็น hash เก่า/scan เลขใบเดิมแต่ revision เก่า | reject stale; เพิ่ม regression/race สำหรับ F08 | A,D,W |
| E03 | content เปลี่ยนหลังเคยเซ็น/แนบ scan | ฉบับเก่ายังค้นคืนได้แต่ไม่ทำให้ฉบับใหม่ document-complete | D,W |
| E04 | legacy 2/4 signatures + PAID ไม่มี recipient | อ่าน/พิมพ์/hash compatibility ผ่าน ไม่มี synthetic destination | U,D,W |
| E05 | key rotation/random ciphertext ต่าง แต่ข้อมูลเดิม | approval/signature hash คงเดิม; missing key fail closed | U,D,O |
| E06 | list/export/audit/log/outbox/LINE/AI payload | ไม่มีเลขเต็ม/secret fingerprint; reveal มี auth/audit/no-store | A,D,W |
| E07 | sensitive print URL/cache/share/download ข้ามผู้ใช้ | ไม่ bypass reveal scope; cached full content ไม่ส่งไป masked reader | A,W |
| E08 | HTML/XML/script ใน label/holder/reason | render escaped ทั้ง UI/SVG/print; ไม่สร้าง stored XSS | U,W |
| E09 | reviewer เรียก API mutation แล้ว response detail | masked mapper เช่นเดียวกับ GET; no plaintext ผ่าน response อีกช่อง | A |
| E10 | grouping ใบของคนเดียวแต่คนละบัญชี/currency/method | ห้ามรวมเป็น transfer เดียว; ตรวจ spec/adapter หากมี grouping consumer | U,D |
| E11 | VAT/WHT/source projection/payment mirror/ledger/reconciliation | source IDs/ยอด/posting/reversal เดิมถูกต้อง ไม่มี account-wallet posting ใหม่ | D |
| E12 | old paid/unpaid/draft/rejected/partial + existing transfer not recorded | rollout inventory แยกชัด; reissue/settle ตาม spec ไม่ backfill เดา | D,O |
| E13 | old API client ไม่ส่ง recipient/version | protected new writer ปฏิเสธพร้อม reload; ไม่ drop snapshot | A,W |
| E14 | feature OFF/entitlement expired/suspended company | เคารพ guard เดิม; read/recovery ตามสิทธิ์; ไม่ลบ snapshot | A,W,O |
| E15 | rollback application หลังมีใบแบบใหม่ | reader + safety/hash guards คงรองรับ; old writer ไม่ bypass | D,O |
| E16 | เจ้าของหนึ่งคน/ทีมหลายสาขา + mobile/keyboard + network ช้า | journey ครบ role/scope/loading/error/readonly ไม่มีปุ่มตันเงียบ | A,W |

Coverage: 84 กรณี (A16 + B24 + C12 + D16 + E16) และ policy combinations ภายใน C01/C02 ต้องแตกเป็น test cases จริง Coverage นี้เป็นรายการรับงาน ไม่ใช่ผล test 84/84

## Verification ที่ทำจริง

รันจาก `apps/api`:

```sh
pnpm exec tsx --test src/modules/reimbursements/domain/logic/reimbursement.logic.spec.ts src/modules/reimbursements/domain/logic/claim-form.logic.spec.ts
```

ผล: PASS 92 tests / 22 suites, fail 0, skip 0; log `/tmp/reimbursement-multi-account-baseline-20261005.log` เป็น baseline ของพฤติกรรมเดิมเท่านั้น ไม่มี recipient fields ให้ทดสอบใหม่ ยังไม่ได้รัน API reproduction ของ F08–F10, PostgreSQL migration/concurrency, browser E2E หรือ cloud/live payment

ตรวจ links/local evidence paths, scenario IDs และ scoped whitespace หลังเขียน docs ดูผลใน memory แผนใช้ product/architecture/implementation/integration evidence ไม่เพิ่ม legacy role-gate sections จึงไม่ใช้ `pnpm agent:gates`

## Evidence map

ตำแหน่งเป็น local source ที่อ่านในการ audit (line numbers อาจเปลี่ยนเมื่อมีงานอื่นแก้):

- E1: [contracts inputs/payment](../../packages/contracts/src/reimbursements.ts), [DTO](../../apps/api/src/modules/reimbursements/presentation/http/reimbursement.dtos.ts)
- E2: [Prisma schema: CompanyMembership, EmployeeAccessProfile, ReimbursementRequest/Payment, BankAccount](../../apps/api/prisma/schema.prisma)
- E3: [create/update/submit/reopen/cancel use cases](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts)
- E4: [snapshot hash / signature ack / payment validator](../../apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts)
- E5: [create selector context](../../apps/web/src/features/reimbursements/ReimbursementCreatePage.tsx), [PaymentForm](../../apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx), [journey actions](../../apps/web/src/features/reimbursements/ReimbursementJourneyPage.tsx)
- E6: [finance/payment use case](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-finance.use-case.ts), [repository: recordPaymentAtomic/assertClaimPaymentReady](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)
- E7: [repository: reopen, recordFinanceReviewAtomic, begin/completeCancellationAtomic](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts), [projection orchestrator](../../apps/api/src/modules/reimbursements/application/services/reimbursement-projection-orchestrator.service.ts)
- E8: [claim signature/signed copy use case](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-claim-signature.use-case.ts), [repository: linkSignedClaimFormCopy/listSignedClaimFormCopies](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts)
- E9: [detail mapper](../../apps/api/src/modules/reimbursements/application/dto/reimbursement.mapper.ts), [claim form](../../apps/api/src/modules/reimbursements/application/use-cases/reimbursement-claim-form.use-case.ts), [renderer](../../apps/api/src/modules/reimbursements/domain/logic/claim-form.logic.ts)
- E10: [approval spec](../specs/reimbursement-approval-spec.md), [step journey](../specs/reimbursement-step-journey-spec-th.md), [routing policy](../specs/reimbursement-approver-routing-policy-spec.md)
- E11: [banking match source](../../apps/api/src/modules/banking/infrastructure/prisma-match-source.query.ts), [payment mirror tests](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.payment-mirror.spec.ts), [void reversal tests](../../apps/api/src/modules/reimbursements/application/use-cases/void-reimbursement-payment-reversal.use-case.spec.ts)
- E12: [encryption helper](../../apps/api/src/modules/system-partner-management/domain/logic/credential-cipher.logic.ts), [employee encryption usage](../../apps/api/src/modules/employee-access/application/use-cases/create-employee.use-case.ts)

- E13: [source payer checks](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts), [source consistency historical/new boundary](../specs/reimbursement-source-consistency-spec.md)
