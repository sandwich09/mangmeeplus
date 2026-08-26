# Spec: Expense Owner Journey — Number Correctness and Decision Clarity

Status: Draft for review
Source: UAT smoke test 2026-08-22, release `a094c0d3` (UAT run 32519171189), company `WatchDog UAT / Head Office`, persona "ป้าวัย 40 เจ้าของร้าน ไม่ถนัดเทคโนโลยี"
Owner: TBD

## 1. Product goal

A shop owner with no accounting background must be able to (a) trust every number the app shows her
without cross-checking, and (b) reach a correct decision on every screen without guessing. The UAT
sweep found the journey is largely well built — the manual-entry form, the upload page, the guides
and the 4-step substitute-receipt wizard are all strong — but four displayed numbers are wrong or
self-contradictory, and five decision points hide the rule that governs them.

Out of scope: new features, the LINE surface, mobile-specific layout, and anything touching the
release chain.

## 2. Users and journey

- **เจ้าของร้าน (owner)** — records expenses, checks what is owed, sends evidence to the accountant,
  adds staff. Reads Thai only. Judges the app by whether its totals match her own head.
- **สำนักงานบัญชี (external accountant)** — receives the exported evidence bundle. Needs each
  document's category and evidence state to be visible before export.

Main journey under test: dashboard → รายการค่าใช้จ่าย → บันทึกด้วยมือ → ตรวจ 3 ขั้น → หมวดหมู่ →
หลักฐานทางบัญชี → การเบิกจ่าย → พนักงานและสิทธิ์.

## 3. Problems, rules and acceptance criteria

### F1 — Input VAT must not be advertised as reclaimable when the evidence cannot reclaim it

**Observed.** `รายการค่าใช้จ่าย` (ส.ค. 2569) shows a card `ภาษีซื้อ (VAT) ฿11.78` with the caption
`เครดิตภาษีที่ขอคืนได้`. The only document in that period is `EXP-202608-00003` (Starbucks), a
**ใบกำกับภาษีอย่างย่อ**, whose own detail page states `ใบกำกับภาษีอย่างย่อ — ลงเป็นค่าใช้จ่ายได้
แต่ขอคืนภาษีซื้อไม่ได้` and whose tax-evidence status is `หลักฐานประกอบเท่านั้น`.

**Rule.** The reclaimable-VAT figure must sum only documents whose tax-evidence status grants an
input-VAT credit. VAT carried by non-crediting evidence is a cost, not a credit.

**Acceptance criteria.**
- AC1.1 A period containing only non-crediting evidence shows `฿0` in the reclaimable card.
- AC1.2 Where non-crediting VAT exists, it is surfaced under a separate, differently-worded figure
  (e.g. `VAT ที่รวมเป็นค่าใช้จ่าย`) so the amount is not lost.
- AC1.3 The card caption states which documents it counts.

### F2 — Reimbursement totals must exclude cancelled requests

**Observed.** `การเบิกจ่าย` shows `฿409 ยอดรวมที่ขอเบิก` over 4 rows: 40 (รออนุมัติ), 30 (ยกเลิก),
50 (ยกเลิก), 289 (จ่ายแล้ว). 40+30+50+289 = 409, so cancelled requests are included.

**Rule.** A cancelled request is not an amount anyone intends to pay and must leave every
money total. "ยอดรวมที่ขอเบิก" means outstanding intent to pay.

**Acceptance criteria.**
- AC2.1 Cancelled requests are excluded from `ยอดรวมที่ขอเบิก`. **Owner decision needed:** whether
  the figure then means outstanding-only (`฿40`) or requested-excluding-cancelled (`฿329`). Both are
  defensible; the caption must match whichever is chosen. Do not implement until this is answered.
- AC2.2 The caption names the states counted.
- AC2.3 A `ยกเลิก` filter tab exists; the tab counts sum to the `ทั้งหมด` count. Today
  ร่าง 0 + รออนุมัติ 1 + อนุมัติแล้ว 0 + จ่ายแล้ว 1 = 2 against `ทั้งหมด 4`, so two rows are
  reachable from no tab.
- AC2.4 Every request carries a document number in every state; cancelled rows must not render `—`.

### F3 — One role must report one menu count

**Observed.** `บทบาทและสิทธิ์` reports role `แอดมิน` as `4 เมนูที่เปิด`. `รายชื่อพนักงาน`, for the
only holder of that role, reports `ใช้งานได้ 2 เมนู`.

**Rule.** Both screens answer the same question and must use the same computation. If one is the raw
role grant and the other is the entitlement-filtered effective grant, they are different questions
and must be labelled as such — this is the same raw-vs-filtered confusion #201 fixed for the role
picker.

**Acceptance criteria.**
- AC3.1 Both screens show the same number for the same role, or each states its basis explicitly.
- AC3.2 Where a menu is withheld by feature entitlement rather than by the role, the employee screen
  says so.

### F4 — Category choices must not be filtered silently

**Observed.** `หมวดหมู่` lists 12 categories, all toggled on, including `ค่าอาหารและเครื่องดื่ม`
(`V7 · ภาษีซื้อขอคืนได้ 7%`). The category picker inside the expense review offers only 5 —
exactly the categories whose default tax code is not V7. The standalone substitute-receipt wizard
offers the same 5. A coffee expense therefore cannot be filed as `ค่าอาหารและเครื่องดื่ม`.

**Rule.** The filter itself is correct: a document that cannot reclaim VAT must not take a category
whose default tax code reclaims VAT. What is missing is that the user is never told, and is left to
miscategorise into `ค่ารับรอง` or `ค่าใช้จ่ายเบ็ดเตล็ด`, corrupting her own reports.

**Acceptance criteria.**
- AC4.1 The picker states why categories are hidden and how many.
- AC4.2 Hidden categories are shown disabled with the reason, or a link explains the rule.
- AC4.3 The message names the unblocking action (obtain a ใบกำกับภาษีเต็มรูป, or set a tax code).

### F5 — Role names must be in Thai everywhere

**Observed.** The same ten roles render in Thai on `บทบาทและสิทธิ์` (บัญชี, แอดมิน, ผู้ตรวจสอบ
(อ่านอย่างเดียว), การเงิน, ฝ่ายบุคคล, คลังสินค้า, ผู้จัดการ, การตลาด, ฝ่ายขาย, พนักงาน) and in
English on `เพิ่มพนักงาน` step 3 and on the employee preview card (Accountant, Admin, Auditor
(Read-only), Finance, HR, Inventory, Manager, Marketing, Sales, Staff).

**Rule.** One display name per role, in Thai, from one source. The add-employee screen is the
decision point and is currently the English one.

**Acceptance criteria.**
- AC5.1 Role display names come from a single catalogue and render identically on all screens.
- AC5.2 No English-only role label remains in the owner-facing UI.
- AC5.3 `บทบาทและสิทธิ์` lists 13 roles while the picker offers 10; the three that are not
  assignable state why.

### F6 — The accounting-evidence screen must show what the accountant checks

**Observed.** `หลักฐานทางบัญชี` is captioned `เอกสารที่ยืนยันแล้ว พร้อมส่งให้สำนักงานบัญชี` with
`ยืนยันแล้ว 3 รายการ`, yet `EXP-202608-00002` is `รอตรวจประเภทเอกสาร`, `รอตรวจหลักฐานภาษี` and
`ยังไม่จัดหมวด`. The table has no category column at all, although the page exists to check
categorisation before export.

**Acceptance criteria.**
- AC6.1 The table shows each document's category, with `ยังไม่จัดหมวด` visible in the row.
- AC6.2 The headline count and caption distinguish "ยืนยันแล้ว" from "พร้อมส่ง"; a document needing
  review is not described as ready.
- AC6.3 Export either excludes not-ready documents or warns before producing the bundle.

### F7 — The "no receipt" path must be reachable when there is genuinely no file

**Observed.** With the strict cash-evidence policy the substitute-receipt button is blocked by
`หลักฐานประกอบอย่างน้อย 1 ไฟล์ · หลักฐานการชำระเงิน`. Relaxing the policy to
`อนุญาตให้ใช้เอกสารประกอบรายการเพียงอย่างเดียว` removes the second requirement but **one file
remains mandatory**, so an owner who paid cash and holds nothing at all cannot finish. The guide
documents the two-evidence design deliberately (topic 7), so the control is intended — the gap is
that no configuration serves the empty-handed case and the wizard never says an admin can relax it.

**Acceptance criteria.**
- AC7.1 The blocking message names the policy and, for a user with rights, links to
  `ตั้งค่าใบรับรองแทนใบเสร็จ`.
- AC7.2 Product decides explicitly whether a zero-file path is permitted; if yes it requires a
  written declaration in place of a file, if no the guide and the wizard both say so up front.
- AC7.3 `หลักฐานเมื่อชำระเงินสด` marks `(ค่าเริ่มต้น)` on the option that is actually the default —
  today the label sits on the unselected option.

### F8 — Second-tier clarity fixes

- AC8.1 The inline substitute-receipt form inside the expense review gets visible field labels; its
  three unlabelled controls today render as bare `sandwich`, `เงินสด`, `22 ส.ค. 2569`. Preferably it
  routes into the 4-step wizard instead of duplicating it.
- AC8.2 `อัปโหลดใบเสร็จ` adopts the manual page's pattern: button disabled with the reason shown,
  rather than an enabled button that errors.
- AC8.3 Required-field errors appear after interaction, not on first paint —
  `กรุณากรอกชื่อผู้ขาย` currently greets the user in red before she types.
- AC8.4 `ข้อมูลที่ยังขาด: ข้อมูลที่ต้องตรวจเพิ่ม` names the actual missing fields.
- AC8.5 The AI panel does not say `ต้องตรวจสอบก่อนยืนยัน` on an already-confirmed document.
- AC8.6 Date of birth accepts พ.ศ. or states the era conversion; the rest of the app shows พ.ศ.
- AC8.7 `เลขบัตรประชาชน` is checksum-validated, or stops being mandatory.
- AC8.8 The substitute-receipt guide says 6 steps; the wizard shows 4. One number, in both.

## 4. Severity and coverage

Severity taxonomy used: **critical** = blocked/error, **high** = wrong display, **medium** =
confusing flow, **low** = cosmetic.

| Severity | Findings |
|---|---|
| critical | none — nothing crashed, and every flow had a forward path |
| high | F1, F2 (total + missing tab), F3, F4, F5 |
| medium | F6, F7, AC8.1, AC8.3, AC8.6, AC8.7, plus 13 near-duplicate role names |
| low | AC8.2, AC8.4, AC8.5, AC8.8, English `Username` label |

### What was NOT tested — do not read these as passing

- **Actual file upload.** The OS file picker cannot be driven from the browser tools, so
  `อัปโหลดใบเสร็จ`, OCR, and any evidence attachment were never exercised. Only the empty-submit
  validation was checked.
- **Substitute receipt to PDF.** Blocked at the evidence gate (F7); signing, approval and the
  resulting PDF are unverified.
- **Employee creation completion.** Stopped after step 3 of 4; a draft for `นางมาลี ใจดี`
  (`malee.testqa`) may persist in UAT and should be removed. Deliberately not completed because the
  form demanded a national ID and a fabricated one was used to probe validation.
- **`การเบิกจ่าย` sub-tabs** คิวอนุมัติ / คิวการเงิน / ตั้งค่านโยบาย.
- **Guides** for ค่าใช้จ่ายและใบเสร็จ and การเบิกจ่ายและอนุมัติ (only the substitute-receipt guide
  was opened).
- **Dashboard vs list reconciliation.** The dashboard shows `ค่าใช้จ่ายที่ยืนยันแล้ว 0 บาท` beside
  `ยอดค้างชำระ 289 บาท` on the `วันนี้` filter. The 289 is consistent with real records elsewhere,
  so this was **not** confirmed as a defect and is recorded only as unreconciled.

## 5. Non-goals

Redesigning the permission matrix, changing the tax-code catalogue, and altering approval routing.

## 6. Evidence

UAT run `32519171189`, candidate `a094c0d375f833c1a2788541e6b2c150258d4f47`, all three services
`ACTIVE … health=ok`. Every observation above was reproduced in the browser against that build.
The cash-evidence policy was switched to the permissive option to prove AC7 and **restored to
`บังคับหลักฐานการจ่ายเงินแยกอย่างน้อย 1 ไฟล์`** afterwards.
