# Thai UX Standard for the sold screens

## Status

In force from 2026-10-13. Source: the owner's guideline "Thai Human-Centered UX/UI Guidelines for AI Coding" (received 2026-10-13), the sources it cites, measurements made on this app's own fonts, and the owner's review rounds of 2026-10-12/13 (spec `expense-payment-preparation-voucher-spec-th.md` D24–D32). Research notes and the screen inventory live with the task: `docs/agent-memory/sold-features-ux-program.md`.

Scope: every screen a shop on a sold package can reach (`TIER_FEATURE_PRESETS` in `packages/contracts/src/menu-entitlements.ts`, plus sign-in, sign-up, package purchase, own profile). Staff consoles and unsold modules are not held to it.

The user is a Thai shop owner or the one person who does the shop's paperwork. Not an accountant. Works on a phone first (390 px wide), sometimes on a laptop. The test for every screen:

> A person who has never used the system looks at the screen and knows where they are, what to do, which button to press first, and what will happen after.

If an element does not help that, remove it, merge it, or make it quieter. Usability outranks decoration.

## 1. Words

1. **One name per thing, everywhere** (menu, title, button, toast, error, print, bell). The glossary below is binding; add to it instead of inventing a synonym.
2. **A button says what happens**: verb + object (`บันทึกร่าง`, `ส่งอนุมัติ`, `ออกหนังสือรับรอง 50 ทวิ`). Never bare `ตกลง`, `OK`, `ดำเนินการ`, `ใช่`/`ไม่`. Bare `ยืนยัน` only inside a dialog whose title already names the action.
3. **Say it once, in one sentence.** A hint is one line. A dialog body is one sentence. Nothing repeats the title, the label, or what the screen already shows. What happens next belongs in the message shown after the action.
4. **Plain Thai.** No `กรุณา`/`โปรด` where it adds nothing, no `ดำเนินการ`, `ทำการ`, `ท่าน`, `ดังกล่าว`, `…หรือไม่`. No English, code, id or status name on screen (brand and unit words such as LINE, QR, PDF, VAT are fine).
5. **No polite particle in the web app** (`ค่ะ`, `ครับ`, `นะคะ`): buttons, labels, hints, errors, toasts and dialogs speak in one neutral voice. The LINE assistant keeps its own voice in LINE.
6. **An error says what happened and what to do**, in the words of the field's label, next to the field. A refusal always carries a way out on the same screen (a button or link to the place that fixes it).
7. **Wording must be true in every case** the sentence can appear in. Build sentences from facts in one place; do not patch one string.

### Glossary

| Thing | Use | Do not use |
|---|---|---|
| The customer's business | `ร้าน` | `บริษัท`, `กิจการ` (except a legal name or the legal pages) |
| Draft (state) / save a draft | `ร่าง` / `บันทึกร่าง` | `ฉบับร่าง`, `แบบร่าง`, `บันทึกฉบับร่าง`, `เก็บร่างไว้ก่อน` |
| Close a window, nothing lost | `ปิด` | `ยกเลิก` for this meaning |
| Abandon what I typed | `ยกเลิก` | — |
| Void a document or payment | `ยกเลิกเอกสาร`, `ยกเลิกรายการจ่ายนี้`, `ยกเลิกใบ`; the safe button is `ไม่ยกเลิก` | a dialog with two `ยกเลิก` |
| Delete | `ลบ` + object; the safe button is `ไม่ลบ` | `ลบถาวร` unless a softer delete also exists |
| Edit | `แก้ไข` (+ object when two things could be edited) | `เปลี่ยน` for the same act |
| Back | `กลับไป` + the place (`กลับไปรายการค่าใช้จ่าย`); a wizard step back is `กลับ` | `ย้อนกลับ`, `‹` |
| Next step | `ถัดไป` | `ดำเนินการต่อ` |
| Try again | `ลองอีกครั้ง` | `ลองใหม่` |
| Done | verb + `แล้ว` (`บันทึกแล้ว`, `ส่งอนุมัติแล้ว`) | `สำเร็จ`, `เรียบร้อยแล้ว` |
| Send for approval | `ส่งอนุมัติ` | `ส่งขออนุมัติ`, `ส่งให้อนุมัติ`, `ส่งให้ผู้อนุมัติ` |
| Expense check, then commit | `ตรวจ`, then `ยืนยันเอกสาร` | — |
| Seller on a receipt / who gets paid / address-book menu | `ผู้ขาย` / `ผู้รับเงิน` / `คู่ค้า` | mixing them on one screen |
| Proof of payment | `หลักฐานการจ่าย` | `สลิป` as a field name (it may be cash) |
| Substitute receipt | `ใบรับรองแทนใบเสร็จ` (the full legal name only on the paper) | `ใบแทนใบเสร็จ` |
| Withholding certificate | `หนังสือรับรอง 50 ทวิ`; the act is `ออกหนังสือรับรอง 50 ทวิ` | `พิมพ์เอกสาร 50 ทวิ` for the act of issuing |
| Press | `กด` | `คลิก` |
| A claim for money back | `ใบเบิก` (`สร้างใบเบิก`, `แก้ไขใบเบิก`, `ยกเลิกใบเบิก`) | `คำขอเบิก`, `คำขอ` for a claim |
| Signature / to sign, on screen | `ลายเซ็น` / `เซ็น` | `ลายมือชื่อ`, `ลงนาม` (a printed form keeps its formal words) |
| Pay | `จ่าย`, `จ่ายเงิน` | `ชำระ` in a new sentence (the expense page and the package screens still carry it until their own rounds) |
| The code we send by e-mail | `รหัสยืนยัน` | `OTP` |
| Where a missing e-mail may be | `อีเมลขยะ` | `สแปม` |
| Our support people | `ทีมงานมั่งมี` | `ผู้ดูแลระบบ`, `เจ้าหน้าที่` for the same people |
| What a package allows | `ใบเสร็จ N ใบ` | `โควตา` |
| The package page and menu | `แพ็กเกจ` | `แพ็คเกจ`, `แพลน` |
| The shop's settings menu | `ตั้งค่าร้าน` | `ตั้งค่าบริษัท` |
| The owner role | `เจ้าของกิจการ` (the role name in contracts) | `เจ้าของร้าน`, `เจ้าของบริษัท`, `เจ้าของธุรกิจ` |

Words that also appear in LINE messages, API sentences and printed documents (for example `คำขอเบิก`, `ลงนาม`, `ฉบับร่าง`) are changed on the web screens only in this round; the other channels wait for the owner's word (see the plan's open list). The menu name `แดชบอร์ด` is unchanged everywhere for the same reason.

Formats: money `฿1,200.00` on screen (`1,200.00 บาท` inside a sentence or on a document); dates `13 ต.ค. 2569`; always commas and two decimals for money; Arabic digits.

## 2. Buttons

1. **One primary button per view.** A dialog is its own view. Row actions in a list are never primary. Everything else is secondary, quiet (text or outline) or destructive.
2. **One look.** Four variants only: primary, secondary, quiet, destructive, from the shared button layer (`.mangmee-btn*` classes and the `Button` component, which render the same). No hand-styled `<button>` in a sold screen.
3. **Buttons that sit together are one size** (owner, 2026-10-13): same height always; same width when they form a pair, a row or a stack. Side by side they take the width of the longest name; when the names do not fit side by side they stack at one width. Never a short button beside a long one, never a name wrapped inside a narrow button. A lone button has a minimum width and does not stretch across a wide screen.
4. **One order.** The button that backs out comes first, the button that acts comes last: at the right on a row, and **on top when stacked** on a phone. A destructive action is red, named with its verb, never the focused default.
5. **Height** 44 px on phones, 40 px from 640 px up, for every variant and in every dialog.
6. **One control per destination** in a row or card: no number that links to the same page as the button beside it.
7. **A lone action is shown as itself.** A `เพิ่มเติม` menu exists only for two or more rare actions, and never hides the main action or something the screen's own text tells the person to press.
8. **A press answers at once**: the same button shows it is working (`aria-busy`), cannot be pressed twice, and does not change width.
9. Avoid a permanently disabled main button with no explanation: keep it enabled and say what is missing on press, or show the reason beside it.

## 3. Layout

1. **Order of the screen follows the order of the work**: where am I (one `h1`) → what to do → fields or content → the main button → the result. No summary card above the task, no section added to fill space.
2. **Phone first, then wide.** Every screen is looked at at 390, at 1280 and at one wide window (1536 or wider) with the side menu open (also 360 and 768 for anything that looks tight). No horizontal page scroll. A wide screen is not a stretched phone: short fields sit two or three to a row from 768 px, content has a comfortable maximum width, a fixed bottom bar starts at the content edge (`--workspace-content-left`), buttons are compact and right-aligned.
3. **One page frame** for sold pages: the shared page header (title, optional one-line description, back link, page actions). No private `h1` styles. **Every page fills the content area** (owner 2026-10-13: "ทำไมไม่ทำเต็มจอ"): the frame has no narrow or centred variant, and no card or field carries a private maximum width, so every block in a page shares the page's two edges. A page uses a wide window with its own layout (short fields two or three to a row, a control row beside its buttons, a table), never by leaving half the screen empty. **A form's buttons end the form** in the shared action bar (`FormActionBar`): it rests under the last field and stays at the bottom of the window while the form is taller than the screen, with what the person checks before pressing (a total, what is missing) at the left. Buttons never sit in a card beside the form (owner 2026-10-13: "ยกเลิก บันทึกร่าง ทำไมไปลอยอยู่ข้างๆ").
4. **No card inside a card**, no border, icon or heading that carries no information.
5. **A number is shown once.** Its make-up (gross, withheld, net) appears only when it differs from the number already shown.
6. **A statement keeps its button on the same row** (the sentence at the left, its action at the right; stacked on a phone).
7. **Lists scale**: more than about six choices get a search box and scroll inside their own box; a table on a phone becomes stacked rows.
8. **Rare things sit behind one labelled disclosure**; required fields never do.
9. An empty list says what belongs there and offers the one action that fills it. Loading never shows the empty sentence.

## 4. Dialogs and steps that cannot be undone

1. A confirmation dialog appears only before something irreversible or costly (delete, void, issue a numbered document, record a payment, send to another person). A routine save has none.
2. The title names the exact thing (document number, payee, amount). The body is one sentence about the consequence. The two buttons name the two outcomes.
3. Closing by the ✕, Escape or the backdrop is always the safe outcome and never loses typed text silently.
4. Money and tax documents get a review before commit (payee, amount, date) and a clear result after, with the next step.
5. One dialog at a time; a multi-step task is a page, not a dialog.

## 5. Thai text on screen

1. `<html lang="th">`; bundled fonts only (IBM Plex Sans Thai for Thai, Outfit for Latin and digits); weights 400–700 (no 800: there is no such face, the browser fakes it).
2. Wrapped Thai text has line-height ≥ 1.5 (≥ 1.6 when bold). Nothing that clips (`truncate`, `line-clamp`, fixed height) may cut the marks above and below Thai letters.
3. Things read as one unit never split across lines: a document number, an amount with `฿` or `บาท`, a date, a phone or tax number, `เลขที่` and its number. Wrap the unit in a no-wrap span; never `break-all` on Thai, never `word-break: keep-all`.
4. Text people must read is at least 14 px; nothing below 12 px. Inputs are 16 px on phones (iOS zooms otherwise).
5. Amounts in columns are right-aligned with `tabular-nums`.
6. A button name never truncates and never takes more than two lines.

## 6. Feedback and states

1. Every action has four states where they apply: working, done (in words: what was done and what is next), failed (what happened, what to do, typed text kept), not allowed (why, and the way out).
2. A system failure is not shown as the person's mistake: `บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ ลองอีกครั้ง`.
3. Status is never shown by colour alone: a badge always carries its word.
4. Tap targets are at least 44 × 44 px on phones with 8 px between neighbours (links inside a sentence are exempt).

## 7. Evidence before "done"

Building and passing tests do not show that a screen is usable. Before a UI change is called done:

- the changed screen and each of its dialogs is opened in a real browser at 390 and 1280 with Thai data, and a picture is looked at;
- button groups are measured (height and width equal), not eyeballed;
- the main journey of the screen is pressed through once, including one wrong turn (empty field, too-early press);
- what was not looked at is said plainly. Never claim a check that was not run.

Checklist for a reviewer:

- [ ] In five seconds: where am I, what do I do, which one button?
- [ ] One primary button; no two controls that do the same thing; button names say the result.
- [ ] No sentence, number or control appears twice; no filler section, card-in-card or decorative icon.
- [ ] Words match the glossary; no particle, no officialese, no English or code.
- [ ] Buttons in a group equal in height and width; back-out first, action last; 44/40 px.
- [ ] Order of the screen follows the order of the work; main button after the last field.
- [ ] Errors next to fields with a fix; refusals with a way out; typed text survives.
- [ ] Working, done, failed and not-allowed states exist where they apply.
- [ ] No split numbers or dates, no clipped Thai marks, no horizontal scroll at 360/390/768/1280.
- [ ] Pictures at 390 and 1280 looked at; what was not checked is written down.
