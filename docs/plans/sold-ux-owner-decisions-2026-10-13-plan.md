# Plan: the owner's decisions on the UX proposals (2026-10-13)

Owner: thawatchai · Standard: [docs/guidelines/thai-ux-standard.md](../guidelines/thai-ux-standard.md) · Programme: [sold-features-ux-program-plan.md](sold-features-ux-program-plan.md) · State: [docs/agent-memory/sold-features-ux-program.md](../agent-memory/sold-features-ux-program.md)

The UX round ended with a list of proposals that needed the owner's word (rule, tax, permission or API). He answered on 2026-10-13. This plan is the record of his answers and the build that follows. Everything stays on the local branch until he says otherwise.

## His answers, in his words, and what each means

| Item | His answer | What is built |
|---|---|---|
| ก1 pay review on the expense page | "บันทึกจ่ายกดได้เลย เรามีทางถอย หรือทางแก้ไขอยู่แล้วใช่ไหม" | Nothing. One press records the payment; the way back is `ยกเลิกรายการจ่ายนี้` on the same page. |
| ก2 owner approves own claim | "ได้" | A person who holds the owner role may always approve a claim they requested, whatever the self-approval switch and approver roles say. Everyone else: unchanged. |
| ก3 signing step of a claim | "ต้องเซ็น หรือ เซ็นจากข้างนอกและอัพโหลดกลับเข้าระบบ ถึงจบได้" | The claim journey ends only when both signatures are in the system or a signed copy is uploaded. Verify the journey says and does exactly that; no optional ending. |
| ก4 payer starts the certificate | "ได้" | The person who recorded an expense with their own money may start a ใบรับรองแทนใบเสร็จ for that expense, without the review right. Signing and approval rules are unchanged. |
| ก5 approver's buttons | "ผู้อนุมัติ กดได้ ตามคำแนะนำ และตีกลับ กลับไปแก้ ความหมายเหมือนกันไหม" | An approver who did not prepare the document gets `อนุมัติ` and `ตีกลับ` (with a reason) only. `กลับไปแก้` (take back, no reason) and `ยกเลิกใบ` belong to the person who prepared or sent it. A person who is both sees `กลับไปแก้`, not `ตีกลับ`. |
| ก6 two ways to switch a person off | "ทั้งคู่ทำงานเหมือนกันไหม ถ้าใช่ … อันเดียวก็พอ" | They do the same for the shop (no access, the seat is freed); the only difference is that `ปิดใช้งาน` also clears the person's LINE assistant conversation. One control remains: the switch `ใช้งาน / ปิดใช้งาน` with a question before switching off; it uses the disable behaviour. |
| ก7 notification settings | "ไม่ต้อง … ใช้ as is ไปก่อน" | Nothing. |
| ก8 two web sign-up routes | "ตอนนี้มีแค่สมัครผ่านไลน์ … ignore ไปก่อน" | Nothing. |
| ก9 upload-only person | "ใช่ ทำได้ตามสิทธิ์ … พนักงานสามารถกรอกสิ่งที่ ai อ่านไม่ออกเองได้" | After sending a receipt, a person without the review right sees `ส่งใบเสร็จแล้ว` with `ส่งอีกใบ` and `ดูรายการที่ส่ง`, not the reviewer's three steps. When the reading left something empty, the same result offers `เติมข้อมูลที่ระบบอ่านไม่ออก`, which opens only the fields that person may edit. |
| ก10 camera | "ถ่ายรูปใบเสร็จแล้วส่งเลย ไม่ต้องกดยืนยันอีกรอบ" | A photo taken with the camera is sent at once. Files chosen from the device keep the send button (several can be picked). A mistaken draft can be deleted from the result. |
| ก11 names | "ใช้ เจ้าของกิจการ ชื่อบทบาท ใช้ ผู้ดูภาพรวมบริษัท ที่เหลือตามแนะนำ" | Role names stay. Tier names lose the English word in brackets. The menu `แดชบอร์ด` becomes `หน้าแรก` on the web. |
| ก12 words in LINE, prints, bell | "กังวลเรื่อง semantic หรือ ai ไม่เข้าใจ … ยังไม่ต้องทำ" | Nothing. LINE, printed papers and bell notices keep their words. |
| ข1 tax answer from document type | "ตามคำแนะนำ" | Choosing the document type sets the tax-evidence answer: `ใบกำกับภาษี (เต็มรูป)` → usable as tax evidence; every other type → supporting only. The person can change it. The table is shown to him for the accountant's confirmation. |
| ข2, ข3, ข4 | "งง ขอ use case เพิ่ม" | Not built. Explained again with examples. |
| ข5 `ถัดไป` in step 2 | "ตามคำแนะนำ" | `ถัดไป` in step 2 of the check saves the check, as step 1 does. |
| ข6 payee on the manual form | "ตามคำแนะนำ" | The manual form asks `จ่ายให้ใคร` with suggestions from คู่ค้า; a new name is saved as typed. |
| ข7 open on the last step | "ตามคำแนะนำ และสามารถกดถอยกลับเพื่อดูข้อมูลได้" | An expense that waits for confirmation opens on the last step for a person who may confirm; the steps stay pressable to go back and look. |
| ข8 `ส่งให้คนอื่นตรวจ` | "ตามคำแนะนำ" | The sender chooses who checks (people who may confirm), that person gets a notice, and the page says who it was sent to. |
| ข9 expense inside a draft document | "ตามคำแนะนำ" | The expense page says `อยู่ในร่างใบเตรียมจ่ายของ …` with `เปิดร่าง`, and does not offer a second way to pay it. |
| ข10–ข16 (claims) | not answered | Asked again. |
| ข17 document list order | "ตามคำแนะนำ" | The payment-document list shows work first: drafts and sent-back, waiting for approval, waiting for payment, then paid by date, cancelled last. |
| ข18 ภ.ง.ด.53 page | "ต้องมี ภงด 3 ด้วยไหม และทั้งหมดควรอยู่กับ ทวิ 50 ไหม" | Not built. Answered with a recommendation; waits for his word. |
| ข19 signature picture | "ตามคำแนะนำ" | The `ลายเซ็นบน 50 ทวิ` page shows the stored picture. |
| ข20 payment method | "ค่าเริ่มต้นเป็นโอน" | Pay forms start on `โอน` (the person can change it). |
| ข21, ข22, ข24, ข26, ข29 | "งง ขอ use case เพิ่ม" | Not built. Explained again with examples. |
| ข23 `รอคุณ` on the home page | "หน้าแรกมีแค่แดชบอร์ด" | Nothing. |
| ข25 shop's own name | "ตามคำแนะนำ" | The owner can edit the shop's own name (the one in the top bar). |
| ข27 AI suggestions menu | not answered | Asked again. |
| ข28 branches | "ให้เหลืออย่างเดียวคือ ปิดใช้งาน" | A branch has one off state, `ปิดใช้งาน`; `เก็บถาวร` is no longer offered. Branches archived earlier stay as they are and read `ปิดใช้งาน`. |
| ข30 one signing | "ตามคำแนะนำ" | Where the shop's setting is that the owner signs and approves alone, one reading and one signing do both roles. |
| ข31 older expenses in the wizard | "รายการเก่าควรขึ้น" | The wizard's list comes from the server as "still needs a certificate", with no 200-row window. |
| ข32 add employee | "ยังเป็นเหมือนเดิม" | Nothing. |
| ข33 LINE link | "ตามคำแนะนำ" | The LINE link is issued from the person's card, the list says linked or not, and a link can be issued again on the spot. |
| ข34 can-do list elsewhere | "ไม่แก้" | Nothing. |
| ค, ง, จ | "บันทึกไว้ถามอีกรอบหลังจาก ก ข แก้ครบ" | Asked again when this plan is done. |

## His second answers, the same day

He read the examples for the items he had not understood, and answered the ones he had skipped.

| Item | His answer | What is built |
|---|---|---|
| ก5 | "ทำได้เลย" | As in the first table (round 1 of lane Q), plus a way out when the preparer is no longer a member: the owner may then cancel or take back. |
| ก6 | "ทำได้เลย" | As in the first table. |
| ข2 no document, no document type | "เห็นด้วย" | When the answer is "no receipt" or "receipt lost", the document type is not asked and is not required to save. |
| ข3 one month, one set of rows | "เห็นด้วย คือวันที่ 30 ก.ย." | The evidence page counts a month by the document date by default, as the expense list does (a receipt dated 30 Sep sent on 2 Oct is September on both). The person can still switch to the day it was sent. |
| ข4 files for the accountant | "เห็นด้วย" | The export for the accounting office carries the receipts: a link per row in the sheet that opens the file for a signed-in person, and one bundle of all files. |
| ข10–ข16 claims | "เห็นด้วย" | ข10 a possible duplicate names the document it may repeat and one confirmation clears it; ข11 the new-claim form knows the shop's receipt rule; ข12 `ส่งอนุมัติ` on the claim form; ข13 a draft that was never sent is deleted without a typed reason (claims and payment documents); ข14 a `ต้องแก้ไข` group with its count in the claim list; ข15 the hub opens on the list that has work for the reader; ข16 the requester's bell notices are checked and repaired if missing. |
| ข18 withholding forms | "ทำได้เลย คุณสามารถให้ค้นหา ดูได้จาก flow account" | ภ.ง.ด.3 beside ภ.ง.ด.53, on one page `ภาษีหัก ณ ที่จ่าย` with the month's certificates. A feature of its own: spec first (`docs/specs/`), FlowAccount looked at as reference, view only. |
| ข21 document title | "เห็นด้วย" | The page title is `ใบเตรียมจ่าย เลขที่ …` or `ใบสำคัญจ่าย เลขที่ …`; the payee is the line under it. |
| ข22 one item, one step less | "เห็นด้วย" | Creating a document from an expense whose payee has only that one unpaid item skips the choose-items step. |
| ข24 my account | "เห็นด้วย แต่เห็นต้องมีประวัติ" | `บัญชีของฉัน` is a page of its own that every member can open; a person can correct their own display name; every change of the name is kept in a history the person and the people who manage employees can see. |
| ข26 notices | "เห็นด้วย" | One notice per document while it waits (a reminder replaces the earlier one), a filter `ยังรออยู่`, a finished notice no longer titled as waiting, and the tag follows what the sentence asks. |
| ข27 AI suggestions menu | "เห็นด้วย" | The menu and its links are hidden for shops whose package has nothing to ask there. |
| ข29 certificate wizard | "เห็นด้วย" | Continuing from step 1 records "no receipt, a certificate will be made" by itself; the reason is asked once on the next screen; the embedded review card is gone from the wizard. |

Further rounds: lane P round 3 (ข2, ข3, ข4); lane Q round 3 (ข21, ข22, ข13 for payment documents, ข27) and round 4 (ข24, ข26); lane R round 3 (ข29, ข10, ข11, ข12) and round 4 (ข13 for claims, ข14, ข15, ข16); lane T (ข18) after its spec.

## Lanes

Three lanes in three worktrees (branches from the programme head), Codex CLI as he asked ("แยก agent ให้ codex cli ช่วยทำเหมือนเดิมตามความยากง่ายของงาน"); the controller reviews each diff, runs the real-database specs and the whole suites, looks at every changed screen at 390, 1280 and 1556, and merges into the programme branch.

- **P: recording and the expense page.** Round 1: ก9, ก10, ข1, ข5, ข7. Round 2: ข6, ข8, ข9, ข20 (expense page). Round 3: ข2, ข3, ข4. Then the defects a person met on round 1.
- **Q: payment documents, shop, people.** Round 1: ก5, ข17, ข19, ข20 (payment document). Round 2: ก6, ก11, ข25, ข28, ข33, and the owner's way out for ก5. Round 3: ข21, ข22, ข13 (payment documents), ข27, and two round-1 defects. Round 4: ข24, ข26.
- **R: claims and substitute receipts.** Round 1: ก2, ก3, ข30. Round 2: ก4, ข31. Round 3: ข29, ข10, ข11, ข12. Round 4: ข13 (claims), ข14, ข15, ข16. Then the defects a person met on round 1.
- **T: ภ.ง.ด.3 and the withholding page (ข18).** Spec: [docs/specs/withholding-returns-pnd3-combined-page-spec.md](../specs/withholding-returns-pnd3-combined-page-spec.md). The form filler and its masters were written by the controller (it needs eyes on the printed result); round 1 is the server, round 2 the page.

## Status (2026-10-13, end of day)

Every item of groups ก and ข that the owner approved is built and merged into the local served branch (`claude/sold-ux-program-20261013`). Nothing is pushed, nothing is deployed.

| Round | Items | State |
|---|---|---|
| P1 to P4, Q1 to Q4, R1 to R4, T1, T2 | all approved items of ก and ข, incl. ข18 (ภ.ง.ด.3 and the combined page) and the files bundle of ข4 | merged |
| Defect rounds PV, PW, PV2, QV, RVc, T3, Q5, R5, guides G3 | what four screen reviews found (V1 to V4) | merged |
| Controller's own walk of the real screens (owner, finance, manager, plain employee; 1556 and 390) | see "Found by pressing" below | fixed, each with a test and a second press |
| PX | the expense page of an expense with no receipt | merged |

Found by pressing the real screens, after every suite and review was green:

- The notification centre's `ทั้งหมด` showed the unread list (a slower earlier answer won).
- The withholding card printed a refusal twice; a download's file name said `all`; two step sentences pointed "above" at a card that sits below.
- The waiting sentence of a payment document offered `ตีกลับ` to a reader who is not offered it.
- In a shop with two owners, a certificate made by one owner waited for the other (the preset certifier was the shop's first owner).
- A declined claim's badge still read `ปฏิเสธ` (the status table in contracts); a declined duplicate claim was told it cannot be cancelled.
- A staff member was let through the certificate wizard's first step with an expense she cannot put right, and refused after typing the next step.
- **The no-receipt journey ended in a dead end.** The wizard's quick record keeps no seller name; after the certificate was issued the expense could not be confirmed (no name) and could not be given one (every printed field is locked until the certificate is cancelled). Rule added, test first on a real database: an expense with no seller name may take the name its certificate prints; any other name, or that name together with another printed change, is refused as before (`substitute-expense-edit.ts`). The expense page arrives with the name filled in; pressing `ถัดไป` saves it. Walked end to end twice (an existing expense, and a quick record through to `ยืนยันแล้ว`).

Owner's answer on ข18's download: the paper form first ("ตามคำแนะนำ"); a file for online filing is a later job.

Schema changes of the batch, both additive: `20261013100000_expense_review_request`, `20261013110000_notification_waiting_recipient`.

Open with the owner: groups ค, ง, จ (to be asked again now that ก and ข are done); the points listed in the final report (LINE keeps `แดชบอร์ด`; `จำนวนราย` on ภ.ง.ด.53; whole name in the first slot of ภ.ง.ด.3; push and release).

## Rules of the build

- Each item is the smallest change that does what the table says. A rule lives on the server; the screen only shows it. No new permission key unless the item cannot be done with the existing ones; no migration unless the item needs a stored fact (ข8 may).
- Rules about money, tax and who may do what are written test-first in a registered API spec file; races and uniqueness in the registered real-database spec file of that module.
- Every new sentence follows the standard; every refusal carries a way out; pages fill the screen and a form's buttons sit in its action bar.
- LINE messages, printed papers and bell wording are not touched (ก12), except the new notice ข8 needs, which uses the existing template mechanism.
- After the three lanes: guides and the LINE help pack follow the screens, the owner's trial list is proven again on the new screens, and the edited browser tests are run.

## Acceptance

Per item: the behaviour in the table, proven by a test on the rule and seen on the real screen as the people involved (owner, finance, manager, plain employee). For the batch: the whole local verification green, real-database specs of the touched modules green, the trial stack rebuilt, and a short Thai report with what he can now try.

## Owner answers, 2026-10-14 evening

- Group ง (decisions taken by the controller): kept, except the claim line's category: "ถ้ามันเลือกได้ มีฟีลด์และค่าเพียงพอ ควรดีฟอลให้ user" — preselect from what the line says (its description; the shop's own earlier line with the same description), never a blind default; the person's own choice is never overwritten (round UX9).
- LINE keeps `แดชบอร์ด` while the web says `หน้าแรก` ("คงเดิม").
- A 50 ทวิ needs the shop's registered name like the tax number and address (the display name was printed when it was missing, unlike the forms): owner "ทำตามที่เสนอเลย" (round B5-6).
