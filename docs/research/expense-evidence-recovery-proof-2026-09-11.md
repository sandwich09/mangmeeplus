# Proof report: ทางออกของ flow ตรวจหลักฐานและใบแทน

วันที่: 11 กันยายน 2569

สถานะ: ตรวจแล้วและลง spec รอแก้ — ไม่ได้แก้ application, merge หรือ deploy ในรอบพิสูจน์นี้

คำขอ: “พิสูจน์ให้ได้แล้วลง spec รอแก้” ต่อจากคำถามว่ามีเส้นทางใด block หรือไม่

## ข้อสรุปที่หลักฐานรองรับ

**ระบบปัจจุบันยังมีทางตัน จึงตอบว่าไม่มีทาง block เลยไม่ได้** ทดสอบเว็บ/API จริงพบว่าขั้น 2 ยังไม่มีปุ่มเก็บร่างเมื่อการตรวจไม่ครบ แม้ API มีความสามารถเก็บค่ารอตรวจอยู่แล้ว ส่วนเงื่อนไขไฟล์/ใบเสร็จและการยืนยันยังไม่รองรับทางหลักฐานอื่นครบ

ปรับขอบเขตตามคำตัดสินล่าสุด: ผู้ใช้ระบุว่ายังไม่มีฟีเจอร์บัญชี จึงตัดการส่งให้บัญชีตรวจและ intent ที่เคยเสนอออกทั้งหมด ใช้ Save draft/reopen เป็นทางเก็บงาน ผลสังเกต B01–B08 คงข้อเท็จจริงเดิม แต่การไม่มีปุ่ม Send ไม่ถือเป็น bug ที่ต้องเพิ่มฟีเจอร์อีกต่อไป G21/T38/T39 และ graph เปลี่ยนตามขอบเขตนี้

[Spec](../specs/expense-evidence-and-substitute-routing-spec.md) จึงปรับ G20/G21, T37–T42 และ §7.6/§13 เพื่อแก้ช่องว่างที่พิสูจน์ได้ พร้อมแบบจำลองที่ตรวจว่า 28 สถานะมีทางเก็บ/รอ/แจ้งสิ่งที่ต้องแก้ และ 3 ทางหลักมีเส้นทางจบเมื่อเงื่อนไขจริงครบโดยไม่พึ่งฟีเจอร์ส่งบัญชี ผลนี้พิสูจน์ความเชื่อมโยงของ **แบบที่ประกาศไว้** ไม่ได้พิสูจน์ว่าโค้ดใหม่ที่ยังไม่เขียนผ่าน E2E แล้ว หรือครอบคลุมความผิดพลาดทุกชนิดที่เป็นไปได้

การรอข้อมูลจริง ผู้มีสิทธิ์ เครือข่าย หรือการแก้งวดบัญชี ไม่ใช่การบันทึกสมบูรณ์ และไม่ใช่เหตุให้ระบบเดาข้อมูลหรือข้ามสิทธิ์ ผู้ใช้ต้องรู้สถานะและทางดำเนินการต่อ ไม่ถูกบังคับสร้างใบแทนใหม่เพื่อหลบ gate

## ขอบเขตและระดับหลักฐาน

ทดสอบที่ worktree `/tmp/mangmee-substitute-step3-edit-20260910`, branch `codex/substitute-step3-edit-20260910`, HEAD `d6abe87e51aa9e87ed08acb702dc9f2f8812cc0d` รวม local app changes เดิมที่มีอยู่ก่อนรอบนี้ จึงไม่อ้างว่าเป็น release บน HEAD ล้วน

| ระดับ | ผล | สิ่งที่ยืนยันได้ | สิ่งที่ยังยืนยันไม่ได้ |
|---|---|---|---|
| Existing focused suites | API 180 + web 37 = 217 ผ่าน; 0 ล้ม | regression ที่ชุดเดิมครอบคลุมบน source ปัจจุบัน | flow ใหม่, ครบทุก permission/ช่องทาง |
| เรียก helper จริงด้วยข้อมูลสังเคราะห์ | 17 assertion groups ผ่าน โดย 8 กลุ่มยืนยัน gap ปัจจุบัน | เงื่อนไขที่เลือกทดสอบคืนค่าตามข้อผิดพลาดที่รายงาน | final API/transaction สำเร็จหรือผลทางภาษี |
| Chromium + API + DB จริงใน local แยก | 8 observations ด้าน pending/save/reload/conflict/mobile | พฤติกรรม UI และ persistence ที่ระบุ B01–B08 | final confirm, alternative route ใหม่, production |
| Executable spec graph | 28 recovery states, 3 conditional completion routes, 3 fault injections ตรวจพบ | มี path ใน graph ที่ประกาศ ไม่บังคับ F1/F2 ผ่านใบแทน | action มีจริงบนเว็บ หรือเงื่อนไขภายนอกจะพร้อม |

ข้อมูลผลลัพธ์พร้อม source SHA-256 และผล cleanup อยู่ใน [evidence JSON](expense-evidence-recovery-evidence-2026-09-11.json) ชุด helper ที่ผ่านมี assertion ว่าปัจจุบันเกิด bug จริง จึง **ห้ามใช้คำว่า pass ของ audit นี้หมายถึงแก้ bug แล้ว** เมื่อ implement ต้องเพิ่ม assertion ผลที่ถูกต้องในชุดทดสอบ module/E2E เดิม

## เว็บ/API จริง: B01–B08

ใช้ seed owner กับ expense สังเคราะห์ยอด 100 บาท ข้อมูลธุรกรรมครบ ประเภทเอกสาร/ภาษีเริ่ม NEEDS_REVIEW ไม่มีไฟล์แนบ อยู่ฐานข้อมูล local แยกบน port 15432 เว็บ 3000/API 3001 ใช้ dev-login และ CSRF ตามระบบ ไม่มี intercept/mock network ในการทดสอบชุดที่บันทึกผลนี้

| ID | การทดลอง | ผลจริงและความหมาย |
|---|---|---|
| B01 | เปิดขั้น 2 ขณะยังรอตรวจ | Next และ Save review ปิด; Save draft 0 ปุ่ม; Send 0 ปุ่ม; Back เปิด → ขาดทางเก็บร่างจากจุดที่ติด; Send อยู่นอก scope ล่าสุด |
| B02 | เลือก RECEIPT แต่ภาษียังรอตรวจ → Back → Next กลับขั้น 2 | ตัวเลือกยังอยู่ใน memory; server ยัง NEEDS_REVIEW และไม่มี acknowledgement; fixture นี้ขั้น 1 ก็ไม่มี Save draft |
| B08 | Reload หลังเลือกค่าที่ยังไม่บันทึก | ตัวเลือกกลับเป็น “รอตรวจประเภทเอกสาร” → การคงค่าเมื่อ Back ไม่ใช่ durable draft ไม่ได้สรุปว่า Back ทำข้อมูลหาย |
| B03 | PATCH review-fields โดยไม่ส่ง documentReviewAcknowledged | HTTP 200; RECEIPT + tax NEEDS_REVIEW เก็บได้และไม่มี marker → ใช้ความสามารถเดิมทำ Save draft สำหรับ reviewer ได้ |
| B04 | POST reviewer-mark-ready บนข้อมูลธุรกรรมที่ครบ แต่ภาษียังรอตรวจ | HTTP 201; READY_FOR_CONFIRMATION โดยไม่มี acknowledgement → ส่งงานไม่เท่ากับตรวจแล้ว; ไม่ได้พิสูจน์ว่า incomplete sourceDraft ส่ง READY ได้ |
| B05 | ผู้ใช้เลือก ABB + SUPPORTING แล้ว API อีกคำขอเปลี่ยน revision จริง ก่อน UI save | HTTP 409; input ที่เลือกยังอยู่; Next ยังปิด; ไม่สร้าง marker; reload ล่าสุดแล้ว save ใหม่สำเร็จ |
| B06 | Save review ของข้อมูลล่าสุดสำเร็จ → reload → Next ถึงขั้น 3 → Back | marker คงอยู่และ Next ยังใช้ได้ → ผลตรวจที่เก็บสำเร็จเรียกคืนได้ ไม่ได้กด final confirm |
| B07 | ขั้น 2 รอตรวจที่ viewport 390 px | ยังไม่มี Save draft/Send; Next ปิด/Back เปิด; ไม่มี horizontal overflow ใน viewport นี้ |

รอบแรกของ harness เคยตั้งสมมติฐานว่าขั้น 1 ต้องมี Save draft แต่ตรวจพบว่าไม่มี จึงปรับเป็น observation และทดสอบซ้ำ ไม่แก้ระบบให้ผลตรงสมมติฐาน อีกจุดคือ raw API ต้องมี CSRF จึงปรับ harness ให้ส่ง token ตาม session ไม่ข้ามกลไกป้องกัน

## Trace โค้ดที่อธิบายผลและสิ่งที่ต้องแก้

| จุด | ข้อค้นพบ | Spec/หลักฐาน |
|---|---|---|
| `ExpenseReviewPage.tsx` + `ExpensesPages.tsx` | submit อยู่ขั้น review/3; Save draft ส่ง prop เฉพาะขั้น data/1 และ component จำกัด DRAFT หรือ NEEDS_REVIEW ที่มี missing sourceDraft; Back จากขั้น 2 ไม่บันทึก review input | B01/B02/B07/B08, G20/G21, T37/T38 |
| `MarkExpenseReadyUseCase` | READY ตรวจ sourceDraft ครบ; รักษาเงื่อนไขนี้และไม่เรียกจาก Save draft ไม่เพิ่ม intent ส่งงาน | B04 + code trace, §7.6, T39 |
| `collectSubstituteReceiptEligibilityIssues` | RECEIPT มี guard แต่ ABB ไม่เท่ากัน; handwriting ใช้เหตุขอใบแทนกว้างเกินไป | P01–P04, G02/G03 |
| current review helper | เปลี่ยน primary/extraction ทำ stale ได้ แต่ v1 ไม่ผูก vendor/amount | P07/P08, G10 |
| receipt/substitute predicate | supporting evidence ไม่พอเพราะอ่านตำแหน่ง primary; ย้ายสลิปเดิมไป primary เปลี่ยนผล; missing reason บังคับ issued | P09–P12, G04/G06 |
| domain confirm validator | ไม่มี primary ต้องตรวจ finance permission ซ้ำ; validator นี้ไม่ได้ตรวจ review marker ด้วยตัวเอง | P13/P14, G05/G07; ไม่ได้กล่าวว่า full confirm API ถูก bypass สำเร็จ |
| repository confirm transaction | มี `reliesOnSubstitute` recheck จึงแก้แค่ FE/preflight ไม่ทำให้ F2 จบ | static trace, G06, plan §2 |
| prepare/issue/accepted VAT writers | ต้องแยก source-owned/certificate-owned facts กัน stale loop และคง final VAT authority | static trace + P17, G19/T36 |

P05/P06/P12/P15–P17 ยังยืนยันว่าข้อมูลจริง/สกุลเงิน/issued artifact/explicit review/VAT authority มีเงื่อนไขที่ต้องรักษา ข้อผิดพลาดเหล่านี้ไม่ควร “แก้” ด้วยการเปิด Next ทุกสถานะ

## Recovery matrix

ทุก action ในตารางนี้เป็น **ข้อกำหนดของ spec model** ต้องนำไปทำและพิสูจน์กับ UI/API ใน T42 ยังไม่อ้างว่าปัจจุบันมีครบ การ save ต้องมีสิทธิ์เขียนและบริการพร้อม หากไม่มีให้เข้า failure/permission state ที่ตรงจริง ไม่มีการส่งงานบัญชีเป็นทางออกใน model ล่าสุด

| สถานะใน model | action/ปลายทางที่ต้องมี | ข้อจำกัดและผู้ดำเนินการ |
|---|---|---|
| PENDING_REVIEW | Save partial draft / เปิดรายการเดิมกลับมาแก้ | ผู้มีสิทธิ์บันทึก; ค่ารอตรวจไม่กลายเป็น review; ไม่ต้องผ่าน Next ก่อน |
| REVIEW_DIRTY | เก็บค่าปัจจุบัน; ตรวจซ้ำเมื่อข้อมูลครบ | ผู้ตรวจยืนยันเอง; generic save ไม่สร้าง marker |
| CERT_DETAILS | เก็บข้อมูลใบแทนที่กรอกไว้บนงานเดิม | ยังไม่จองเลข/ออก PREPARED จนข้อมูลและสิทธิ์ครบ |
| PREPARED | เปิดฟอร์มฉบับเดิม/รอลงนาม | ผู้ลงนามที่มีสิทธิ์; ไม่ออกฉบับซ้ำ |
| SIGNED | เก็บ revision ที่ลงนามและรออนุมัติ | ผู้อนุมัติตามนโยบาย; การรอไม่เท่ากับ ISSUED |
| MISSING_PROOF | เก็บงาน/ระบุหลักฐานที่ต้องเพิ่ม | ต้องได้หลักฐานจริงก่อนกลับตรวจ |
| UNKNOWN_AMOUNT | เก็บ known facts/รอจำนวนเงินจริง | ไม่เติม 0 หรือเดายอดเพื่อให้ฟอร์มผ่าน |
| CASH_STRICT | เก็บงาน/ขอ proof ตามบริษัท | นโยบาย strict ไม่ถูกเปลี่ยนเป็น permissive |
| CHECK_BILL_UNPAID | เก็บสถานะยังไม่จ่าย | รอจ่ายจริง; ไม่แต่ง paidAt หรือออกคำรับรองว่าจ่ายแล้ว |
| NO_REVIEW_PERMISSION | เก็บเฉพาะฟิลด์ที่แก้ได้และแจ้งสิทธิ์ที่ขาด | ไม่ให้สิทธิ์เพิ่มหรือสร้างงานส่งต่อ; ยังตรวจไม่ได้จนมีสิทธิ์จริง |
| NO_CONFIRM_PERMISSION | เก็บผลตรวจเดิมและแจ้งสิทธิ์ที่ขาด | ไม่สร้างงานส่งต่อ; ไม่กลับไปบังคับตรวจใหม่ไร้เหตุ |
| ACCESS_REVOKED | แจ้งขอสิทธิ์/กลับหน้าที่เข้าได้ | ไม่รับประกันการ save/view ข้อมูลที่สิทธิ์ถูกถอน |
| NETWORK_FAILED | คงค่ารอส่งใน session / Retry | ไม่อ้าง server save หรือ durable offline storage |
| SESSION_EXPIRED | Login ใหม่แล้วเทียบ revision | ต้องเป็น principal เดิมที่ยังมีสิทธิ์; ไม่เผยค่าค้างให้บัญชีอื่น |
| CAS_CONFLICT | คง input และเทียบค่าล่าสุด | ห้าม overwrite เงียบ ๆ; reviewer ตรวจชุดที่ตกลงแล้ว |
| READ_ONLY | เปิดดู/ประวัติ/ดาวน์โหลดตามสิทธิ์ | ไม่มีปุ่มแก้ที่สร้างเอกสารใหม่โดยไม่ตั้งใจ |
| ISSUED_CHANGE | ไปขั้นแก้ไข/ยกเลิกที่เกี่ยวข้อง | ผู้มีสิทธิ์บัญชี; ไม่แก้ข้อเท็จจริงของฉบับสมบูรณ์เงียบ ๆ |
| CLOSED_PERIOD | เก็บงาน/แจ้งเงื่อนไขแก้งวดที่ต้องดำเนินการ | ไม่ปลดงวดหรือย้ายวันที่โดยอัตโนมัติ ไม่เพิ่มฟีเจอร์ส่งต่อ |
| UNSUPPORTED_CURRENCY | เก็บรายจ่าย/แจ้งสกุลเงินที่ไม่รองรับ | ใบแทนปัจจุบัน THB เท่านั้น; ไม่รับประกันออกใบแทนทุกสกุลเงิน |
| RENDER_LIMIT | เก็บรายการครบ/แจ้งรูปแบบไม่รองรับ | ไม่ตัดรายการหรือออกเอกสารยอดไม่ครบเพื่อให้พิมพ์ได้ |
| PARTIAL_FUNDING | เก็บข้อเท็จจริง/แจ้งรูปแบบจ่ายที่ไม่รองรับ | งานนี้ไม่เพิ่ม partial/mixed funding หรือการส่งงาน; ไม่ยืนยันจ่ายเต็มแทนผู้ใช้ |
| NO_APPROVER | เก็บฉบับเดิม/ขอตั้งผู้อนุมัติ | ผู้ดูแลตั้งตามสิทธิ์; ไม่ auto-approve |
| POSSIBLE_DUPLICATE | เปรียบเทียบรายการและแก้ตามสิทธิ์ | ไม่สร้าง expense/payment เพิ่มเพียงเพราะยังตัดสินไม่ได้ |
| KNOWN_DUPLICATE | เปิดรายการเดิมตามสิทธิ์ | ไม่ยืนยันรายการซ้ำ |
| VAT_DIFFERENCE | ทางแก้ VAT/ยอมรับยอดตามเอกสารเดิม | ผู้มีสิทธิ์และ audit เดิม; ไม่เพิ่ม review gate ทับ confirmer |
| WHT_CLASS_MISSING | เก็บงาน/ขอประเภทผู้รับที่ถูกต้อง | ไม่เดาบุคคล/นิติบุคคลเมื่อข้อมูลไม่ชัด |
| SOURCE_CHANGED_AFTER_SIGN | แก้ฉบับ mutable เดิมและลงนามใหม่ | ถ้า ISSUED/financial locked ให้เข้า ISSUED_CHANGE |
| REJECTED | เปิดงานเดิมกลับตรวจตามกฎ | ไม่ข้ามเป็น READY/CONFIRMED โดยปุ่มเดียว |

Graph ตรวจ 3 เส้นทางจบ: SOURCE_REVIEWED → final/ready → CONFIRMED; ALT_REVIEWED → final/ready → CONFIRMED; CERT_REVIEWED → details/prepare/sign/issue → final/ready → CONFIRMED สองทางแรกถูกตรวจว่าไม่ต้องผ่าน certificate nodes ส่วนทุก final ต้องมีผู้ยืนยันและข้อมูลบัญชี/ภาษีผ่านจริง

Fault injection ลบ (1) recovery ของ pending (2) final edge ของ alternative (3) ทางเข้า certificate ผลตรวจต้องพบ unreachable ทั้งสามแบบ มี assertion เพิ่มว่า network failure ไม่ได้กลายเป็น confirm, revoked access ไม่ได้เพิ่มสิทธิ์ และ unpaid ไม่ได้จบด้วยการกดปุ่มล้วน ๆ

หลังตัดฟีเจอร์ส่งบัญชีเพิ่ม assertion ว่า graph ไม่มี assignment/request-review/handoff edge และ pending draft ยังมีทาง Save → เปิดรายการเดิม → ตรวจข้อมูล → จบแบบมีเงื่อนไข โดยไม่ต้องผ่านใบแทน การกลับมาทำต่อยังต้องมีข้อมูลและสิทธิ์ครบ ไม่ใช่การผ่านอัตโนมัติ

## คำสั่งและ artifact

รันจาก worktree ข้างต้น ชุด API ใช้ working directory `apps/api`:

```sh
./node_modules/.bin/tsx --test src/modules/expenses/domain/logic/expense-document.logic.spec.ts src/modules/expenses/domain/logic/expense-status.logic.spec.ts src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts
```

ชุด web ใช้ working directory `apps/web`:

```sh
../api/node_modules/.bin/tsx --test src/features/expenses/expense-review-steps.logic.spec.ts
```

Audit ที่เก็บใน repo รันจาก root:

```sh
apps/api/node_modules/.bin/tsx --tsconfig docs/research/expense-evidence-recovery-probes.tsconfig.json docs/research/expense-evidence-recovery-probes-2026-09-11.ts
node docs/research/expense-evidence-recovery-model-2026-09-11.mjs
```

- [Helper probes](expense-evidence-recovery-probes-2026-09-11.ts) / [audit-only tsconfig](expense-evidence-recovery-probes.tsconfig.json) ใช้ helper จริง ไม่มี DB/network
- [Executable spec](expense-evidence-recovery-model-2026-09-11.mjs) ใช้ standard library ไม่มี dependency ใหม่
- Browser harness ที่ใช้ใน session: `/tmp/evidence-recovery-browser-20260911.cjs`; ผล JSON/log ชื่อเดียวกันลงท้าย `.json`/`.log` เป็น temporary artifacts ผล observations ที่ต้องเก็บระยะยาวรวมใน [evidence JSON](expense-evidence-recovery-evidence-2026-09-11.json) แล้ว
- TAP logs: `/tmp/evidence-recovery-api-tests-20260911.log`, `/tmp/evidence-recovery-web-tests-20260911.log`
- Screenshots: `/tmp/evidence-recovery-pending-desktop-20260911.png`, `/tmp/evidence-recovery-pending-mobile-20260911.png` เป็นภาพ baseline local ไม่ใช่แบบ UI ใหม่

## ผลกระทบและงานที่ยังต้องทำ

ตรวจ fixture ก่อน cleanup: expense 1, payment 0, certificate 0, journal 0, outbox event 0; หลัง cleanup exact fixture: ทั้งห้าประเภทเหลือ 0 ไม่แตะข้อมูลลูกค้า/UAT/Production และไม่ได้ทำ final expense confirmation

เทียบ hash ของ tracked application/contract/E2E files 2,595 ไฟล์กับต้นรอบ: ไม่มีไฟล์เปลี่ยนในรอบพิสูจน์นี้ การแก้รอบนี้อยู่ที่ spec/plan/memory/audit scripts และ evidence เท่านั้น local app changes เดิมยังอยู่ครบ

ก่อนรับ implementation ต้องพิสูจน์ T01–T42 ตามชั้นที่ระบุ รวม 3 actual E2E พร้อม final transaction, permission/tenant, retries, source/signature revisions, เงิน/บัญชี/ภาษีไม่ซ้ำ และ T34 กับผู้ใช้จริง ยังไม่มีหลักฐานหลังแก้สำหรับสิ่งเหล่านี้ รอบนี้ส่งมอบหลักฐานและ spec **รอแก้** ไม่รายงานว่าพร้อม merge/deploy
