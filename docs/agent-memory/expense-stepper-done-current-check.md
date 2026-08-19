# Agent Memory: expense review stepper UX — สรรพากร-style redesign, evidence-step unsaved guard

Status: done
Owner: agent session 2026-08-19..20
Scope: `apps/web/src/common/components/steps/ThemedSteps.tsx`, `apps/web/src/features/expenses/ExpenseReviewPage.tsx`, `apps/web/src/features/expenses/ExpensesPages.tsx`, `apps/web/src/common/i18n/workspace-dictionary.ts`, `ThemedSteps.spec.ts`

## Change 3 (2026-08-20, FINAL VISUAL) — สรรพากร-style numbered position stepper

User pivoted the design (reference: RD ภ.ง.ด.90/91 filing stepper): numbered circles, color tracks POSITION not completion memory — "ถ้าถอยก็เป็นสีเทา".

- `ThemedSteps` nodes are now `rounded-full` circles showing the step NUMBER (index+1) in every state: brand green (done/current, halo ring on current), gray-outlined gray number (upcoming), warning ⚠ (attention). No checkmarks anywhere — this supersedes Change 1's done+current=✓ design (the `current?: boolean` prop was removed again).
- Connector segments are brand only behind a passed ('done') node; the current node's outbound segment is gray (the old brand→gray gradient is gone).
- ExpenseReviewPage maps by position: `current` for the step being viewed, else `attention` if flagged, else `index < stepIndex ? 'done' : 'upcoming'`. Stepping back grays the steps ahead even when their server state is complete. `deriveExpenseReviewSteps` is untouched — `detailsStepDone` still gates ส่งตรวจสอบ, and the evidence dirty-guard (Change 2) is untouched.
- Linear wizards (add-employee, substitute-receipt, accounting-tax-setup) already mapped by position, so they inherit the new look with zero changes.

## Change 4 (2026-08-20) — stepper is display-only; navigation via ถัดไป/ย้อนกลับ only

- Removed `onSelect` from the expense review ThemedSteps mapping — nodes render as plain spans. `goToStep` lost its `allowUnsaved` param (chips were its only caller).
- Consequence handled: ยกเลิกรายการ (expenses.reject) used to render only on the review step, and the chip-jump (allowUnsaved) was the deliberate escape for rejecting a draft whose validation errors disable ถัดไป (empty vendor name is error-severity → fresh uploads/manual drafts). It now renders on EVERY guided step so an invalid draft stays rejectable without faking data.
- E2E updated: EXP-04 fills ชื่อผู้ขาย then walks ถัดไป×2 instead of chip-clicking; EXP-04A drops its chip-click (ยกเลิกรายการ visible from step 1). Both pass against the local stack.
- Add-employee wizard (2026-08-20, user asked): its ThemedSteps `onSelect` removed too — display-only, navigation via its own ย้อนกลับ/ถัดไป which validate/submit as before (`goToStep` still used internally for the jump-to-step-4-after-save path). Surgical one-block edit — `AddEmployeePrototypePage.tsx` also carries another session's in-flight changes; only the stepper block was touched.
- Accounting-tax-setup stepper still uses href steps (each step is a page) — left clickable unless the user extends the rule there.

## Change 1 — done step keeps its check while current

Decisions:
- Icon encodes completion only (check = passed); position ("you are here") is the halo ring + aria-current.
- Added orthogonal `current?: boolean` to `ThemedStep`; state `'current'` unchanged, so the three linear wizards (add-employee, substitute-receipt, accounting-tax-setup) need no change — their current step is never done.
- ExpenseReviewPage maps `done` before `current`: a passed step shows ✓ + halo while being worked on. Unfinished/flagged current step keeps the white-square "current" look (no false ✓, attention still suppressed while working on it).
- Rejected "check on every green node": a fresh draft's incomplete step would falsely read as passed.
- User confirmed the language with annotated screenshots: passed = green ✓; visited-but-unfinished non-current = gray square; current = green + halo.

## Change 2 — ถัดไป must not skip unsaved บันทึกการตรวจ edits

Bug report: on step 2 (ภาษีและเอกสาร), edit a dropdown, press ถัดไป without pressing บันทึกการตรวจ → lands on step 3 with everything reading green while the edits were never persisted. Expected: must press บันทึกการตรวจ.

Decisions:
- Block forward navigation (evidence → review) while the DocumentReviewSection is dirty; `toast.warning` names the exact button (`expenses.doc_review_unsaved_next`, th+en).
- Do NOT auto-save on navigate (unlike the data step): `saveDocumentReview` can cascade (clear line tax codes, set NON_CLAIMABLE) — it is a deliberate attestation, so it stays behind the explicit button.
- Going back (evidence → data) stays free: guided sections are CSS-hidden, not unmounted, so edits survive.
- Stepper chips keep `allowUnsaved=true` — the deliberate escape so a reviewer can reach Review to reject an invalid draft.
- Guard skipped when substitute cert is ISSUED (`substituteLocked`) — saving would 409, mirroring the existing data-step guard.
- Plumbing: `DocumentReviewSection` takes optional `dirtyRef` (same house pattern as `ExpenseReviewEditSection.saveRef`); dirty only reported while `isMutable && canReview` so read-only viewers are never blocked.

Open questions: none
Verification: `tsc --noEmit` exit 0; full web suite `npm test` — 967 pass 0 fail (incl. new ThemedSteps done+current spec)
Next: none
