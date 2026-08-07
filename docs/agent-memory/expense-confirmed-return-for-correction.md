# Agent Memory: expense-confirmed-return-for-correction

Status: UI truthfulness fixes landed and verified. Transition feature specced and planned, then **parked by the owner on 2026-08-06** ("memo ไว้ก่อน") — spec §13 Q1–Q4 are unanswered and no API work has started. Resume from plan step 1 once those are answered.

Owner: thawtchai

Scope:
- Reported 2026-08-06 from หลักฐานทางบัญชี: `EXP-202608-00001`, confirmed, `รอบันทึกบัญชี`, flagged ยังไม่จัดหมวด — "opening the detail still lets me edit".
- Investigation showed the opposite: a `CONFIRMED` expense is locked in both layers. The UI simply never said so.
- Owner then set the direction: confirmed must stay uneditable; the correction path is to send the document back to whoever opened it, who fixes it and circulates it back to accounting.

Decisions:
- The record is **not** unlocked. `CONFIRMED` stays read-only; correction happens after the record moves back to `NEEDS_REVIEW`.
- Landing status is `NEEDS_REVIEW`, not a new `RETURNED` status — `REJECTED → NEEDS_REVIEW` is the existing precedent and a new status would have to be taught to every filter, badge and report.
- v1 returns only while nothing is in the ledger (`postingStatus ∈ {pending, posting_error}`, `paymentStatus = UNPAID`). A posted document stays a void-and-re-record case; that keeps the new transition free of reversal machinery.
- `expenseNumber` survives the round trip; the confirm path must reserve only when it is null.

Open questions: spec §13 Q1–Q4 (posted-document return as v2; dedicated `expense.return` permission; notifying the creator; repeat-return limits).

Artifacts:
- `docs/specs/expense-confirmed-return-for-correction-spec.md`
- `docs/plans/expense-confirmed-return-for-correction-plan.md`
- Landed: `apps/web/app/globals.css` (`input/textarea/select.mangmee-input:disabled` — the file had no `:disabled` rule at all, and `.mangmee-input` sets `background`/`color` outright, so every locked field in the app looked editable), `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` (evidence-tab step 2 no longer promises in-place editing), `apps/web/src/features/expenses/ExpenseReviewPage.tsx` (confirmed posting card states the lock and the remedy).

Project-wide sweep for the same defect (2026-08-06, owner asked "ฟีลดิสเบิ้ลมีปัญหาแบบนี้อีกไหม"). Scanned every JSX `input`/`textarea`/`select`/`button` opening tag in `apps/web` that carries a `disabled` attribute — 54 form controls, 343 buttons — and resolved each one's class expression:

- **Fixed, systemic.** `.mangmee-btn` had no `:disabled` rule either, and `.mangmee-btn-secondary:hover` matched disabled buttons, so a locked secondary button still lit up brand-green under the cursor. Both now carried on the primitive in `globals.css`.
- **Fixed, latent.** `EmployeeAccessPages.tsx:121` defined its own `inputClass` with no disabled variant while its three sibling button classes had one. No call site passed `disabled` yet, so nothing was broken — the next one would have been invisible. Given the same `disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400` the shared `Field.tsx` inputs use.
- **Fixed, adjacent defect class.** `AccountingTaxSetupPage` — the two step gates were `<Link aria-disabled … pointer-events-none>`, which stops the mouse and nothing else: a keyboard user tabbed onto the blocked step and Enter navigated past the gate. Replaced by a local `next()` helper that renders a plain inert `<span>` when the step is blocked. `PoApprovalSettingsPage` — the rule limit was a `readOnly` `<input>`, white and bold with a brand focus ring, on a row where nothing edits the rule; now a styled `<span>` that keeps the boxed look without the editing affordance.
- **Left alone, noted.** Two more dead affordances share that PO-approval row: the ลบขั้นอนุมัติ button and the `PencilMarker` beside the approver both have no handler. Same "looks interactive, isn't" family, but they are unfinished features rather than a styling gap — worth a decision, not a silent edit.
- **Clean.** `field/Field.tsx`, `ThemedSelect`, `ThemedDate`, `TransactionTaxLineSelector`, both toggle components, the prototype `SelectField`, every button class constant, and native checkboxes (no author colour override, so the browser greys them). No component was found that declares a `disabled` prop and fails to forward it — nowhere is "disabled" a functional lie.

Verification: `apps/web` typecheck clean. No API change yet — nothing to test there.

Next: owner answers spec §13, then plan steps 1–7. Step 1 carries the one real risk — widening `ALLOWED_TRANSITIONS.CONFIRMED` affects every `canTransition` caller, so audit them before landing it.
