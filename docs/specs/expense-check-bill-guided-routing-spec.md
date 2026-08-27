# Expense Check-bill Early Rejection and Guided Routing Spec

## 1. Status

- Status: Core delivered; recovery/proof completion in progress, 2026-08-27
- Owner request: 2026-08-24
- Product area: Expenses / document extraction / substitute-receipt routing
- Primary incident: Production company `MangmeePlus` (`บริษัท มั่งมียั่งยืน จำกัด`) accepted a restaurant check bill into expense review, showed six green checks, exposed an inline substitute-receipt form, and then returned an unactionable HTTP 400 after the user completed the form.
- Linked plan: [[plans/expense-check-bill-guided-routing-plan|Expense Check-bill Early Rejection and Guided Routing Plan]]
- Memory: [[agent-memory/expense-check-bill-guided-routing|Expense Check-bill Guided Routing Memory]]

### 1.1 Expanded delivery boundary (owner direction, 2026-08-25)

The first local slice changed only the web application. The owner has now expanded the implementation to the API and LINE journey. The temporary new-expense workaround must be removed before handoff.

The final implementation reuses the same expense. A paid-without-final-receipt decision is carried as explicit input into substitute preparation, then revalidated and committed together with the prepared evidence in the existing database transaction. No replacement expense is created, so there is no old row to auto-cancel. A failed or stale prepare leaves the item classified as a blocked check bill and is safe to retry.

### 1.2 Recovery completion (owner direction, 2026-08-27)

Check bill is an itemized supporting document, not a receipt or proof of payment by itself.
For this classification only, separate real payment evidence is mandatory for every payment
method, including CASH with permissive or missing company policy. This overrides the earlier
cash exception below; ordinary non-check-bill cash policy remains unchanged. The original check
bill cannot be selected as payment evidence, even through another purpose link or finance override.

Every new preparation enters the existing canonical wizard on the same expense. A raw check
bill remains routable after finance correction and through an ordinary deep link/picker; the
current saved classification, not a client route flag, determines its payment-proof requirement.
This does not revoke a genuine finance misclassification correction's normal receipt path or
alter final-receipt replacement. Existing PREPARED edits, history, signatures and approval remain.
No historical certificates are rewritten or removed. Known API failures carry stable codes with
actionable messages; unknown failures retain the safe fallback.

## 2. Executive Product Decision

The system must reject a check bill **as a receipt** as soon as extraction identifies it, but it must not tell the user that the real-world expense can never be recorded.

The user-facing distinction is:

> เอกสารนี้ยังไม่ใช่ใบเสร็จ จึงใช้ยืนยันค่าใช้จ่ายเพียงใบเดียวไม่ได้

The system then asks one plain-language question at a time and offers only valid next actions:

1. upload the final receipt/tax invoice;
2. if already paid but no receipt exists, continue to the substitute-receipt journey with this check bill retained as supporting evidence;
3. if not paid yet, keep an explicit web-upload draft blocked; on LINE, keep only the pending file and do not create an expense; or
4. reject/cancel the wrong document through the existing permission-checked action.

The user must never complete a long form and discover only on the last click that the API never supported the path.

## 3. Source of Truth and Related Decisions

- [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]]
  - A restaurant check bill with a total but no settlement evidence is not a receipt.
  - An explicit web expense upload may retain its draft and original attachment for review.
- [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
  - OCR remains suggestion-only.
  - An internal substitute-receipt certificate is `SUPPORTING_ONLY` and cannot create input-VAT entitlement by itself.
- [[plans/substitute-receipt-first-use-ux-redesign-plan|Substitute Receipt First-use UX Redesign]]
  - The dedicated wizard is the canonical preparation journey.
  - First-time users answer whether an expense already exists before seeing detailed forms.
- [[plans/expense-no-invoice-substitute-routing-plan|Expense No-Invoice Substitute Routing Plan]]
  - No-receipt states should route to the existing certificate flow instead of dead-ending.
- Current shared contract: `packages/contracts/src/expenses.ts`
- Current web review: `apps/web/src/features/expenses/ExpenseReviewPage.tsx` and `ExpensesPages.tsx`
- Current API eligibility: `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`

This spec narrows and corrects the user journey. It does not weaken the existing receipt, tax, signature, approval, branch, permission, or audit boundaries.

## 4. Problem Statement

### 4.1 Current user experience

For an explicit web upload classified as `ORDER_OR_CHECK_BILL`:

1. the expense draft and attachment remain;
2. the page shows a general warning that AI thinks the file is not expense evidence;
3. extracted field checks may still appear green, which visually contradicts the warning;
4. the normal send/confirm action is blocked;
5. the inline substitute-receipt form can still be opened;
6. its readiness logic omits classification, raw document kind, source type, currency, and tax-state blockers;
7. the user completes payer, reason, purpose, date, and attachments;
8. the API rejects preparation before persistence; and
9. because the API throws an un-coded `BadRequestException`, web shows the generic message `ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ...`.

The result feels like user error even though the interface enabled an unsupported action.

### 4.2 Root cause

- There are multiple eligibility implementations:
  - normal expense review;
  - inline substitute preparation;
  - dedicated substitute wizard candidate filtering; and
  - API preparation eligibility.
- The dedicated wizard and API are stricter than the inline form.
- Known API business failures have machine codes in the web dictionary, but most substitute eligibility failures do not return those codes.
- The warning uses accounting/AI language instead of answering the user's immediate question: “What do I do next?”

## 5. Target User and Design Posture

### 5.1 Primary persona

`พี่อร`, age 47, owner/admin staff of a small business:

- uses Chrome on an Android phone;
- can photograph a bill and enter an amount;
- does not know the difference between `sourceDocumentType`, `taxEvidenceStatus`, a finance override, or an input-VAT claim;
- may call every paper from a restaurant “ใบเสร็จ”;
- expects one large, obvious next button;
- is likely to stop when red technical copy appears;
- may tap the same button repeatedly when nothing visibly changes; and
- should not need training or a support call to recover.

Age is not used as a proxy for ability. The interface is deliberately designed for low digital confidence, small-screen use, and unfamiliar accounting vocabulary; this also benefits every user.

### 5.2 UX principles

1. **Reject the document role, not the person or the real expense.** Say what the file cannot prove and what the user can do next.
2. **One question per step.** Do not show tax, document-type, payer, evidence, and signature choices at once.
3. **Use everyday Thai first.** Technical terms may appear only in a secondary “สำหรับฝ่ายบัญชี” disclosure.
4. **One primary action.** A screen must not show two green actions with competing outcomes.
5. **No silent disabled buttons.** Every disabled action has a nearby explanation and a direct repair action.
6. **No toast-only business blocker.** Persistent, inline guidance remains visible after the toast disappears.
7. **Never rely on colour alone.** Use icon, heading, explanation, and action label.
8. **Preserve work.** Back, refresh, and a failed request must not erase the user's confirmed facts or uploaded evidence.
9. **No fake certainty.** AI classification never claims legal or tax validity.
10. **No late surprise.** Web and API use one shared eligibility decision.

## 6. Goals

- Identify and explain a check bill before the user reaches normal review/confirmation actions.
- Make it understandable within five seconds that the file is not yet a receipt.
- Provide a valid path for a real, already-paid business expense without requiring the user to re-enter the entire record or create a duplicate expense.
- Keep the original image and raw classification as provenance.
- Reuse the dedicated substitute-receipt wizard as the single preparation journey.
- Return actionable Thai for every known business blocker.
- Preserve fail-closed tax, payment-evidence, signature, approval, permission, and audit behavior.

## 7. Non-goals

- Do not turn a customer/employee signature on a check bill into merchant settlement evidence.
- Do not label a check bill as a receipt merely because it includes a tax ID, VAT amount, or a total due.
- Do not make an internal certificate a tax invoice or input-VAT document.
- Do not auto-confirm payment from a tap alone; check bills always need separate payment proof. Company cash policy remains authoritative for ordinary non-check-bill expenses.
- Do not add a generic document-management system, new OCR provider, new AI agent, or dependency.
- Do not automatically delete the original draft or attachment.
- Do not broaden quotation, purchase-order, appointment, booking, non-financial, unreadable, or multi-document eligibility.
- Do not change the `PREPARED → PAYER_CERTIFIED → ISSUED` certificate lifecycle.
- Do not implement LINE signing, approval, or final accounting mutation.

## 8. Terminology and User-facing Language

| Internal term | Do not lead with | User-facing Thai |
| --- | --- | --- |
| `ORDER_OR_CHECK_BILL` | classification / document kind | เช็กบิลหรือใบแจ้งยอดก่อนจ่าย |
| settlement evidence | settlement | หลักฐานว่าจ่ายเงินจริง |
| finance override | override | ระบบอ่านผิด — ให้ฝ่ายบัญชียืนยันประเภทเอกสาร |
| substitute receipt | substitute evidence | ใบรับรองแทนใบเสร็จรับเงิน |
| `SUPPORTING_ONLY` | tax evidence status | ใช้เป็นหลักฐานประกอบ แต่ใช้ขอคืน VAT ไม่ได้ |
| `NON_CLAIMABLE` | input VAT status | ไม่ขอคืนภาษีซื้อจากเอกสารนี้ |
| classification blocker | blocker | เอกสารนี้ยังใช้ยืนยันค่าใช้จ่ายไม่ได้ |

Copy rules:

- sentence length should normally stay below 24 Thai words;
- the first paragraph must contain no English or internal enum;
- action labels describe the result, not the implementation;
- do not say “ข้อมูลไม่ตรงกับระบบ” for a known business rule;
- do not say “บันทึกค่าใช้จ่ายไม่ได้” without the qualifier “ด้วยเอกสารใบนี้เพียงใบเดียว”.

## 9. Proposed User Journey

### 9.1 High-level flow

```text
Upload / extraction
  -> accepted receipt evidence
       -> normal expense review
  -> check bill without settlement evidence
       -> stop normal receipt journey immediately
       -> ask: “คุณจ่ายเงินรายการนี้แล้วหรือยัง?”
            -> มีใบเสร็จฉบับสุดท้าย -> upload final receipt -> re-extract
            -> จ่ายแล้ว แต่ไม่มีใบเสร็จ -> confirm basic facts -> attach payment proof
               -> record explicit substitute routing resolution
               -> dedicated substitute-receipt wizard
            -> ยังไม่ได้จ่าย -> web keeps blocked draft; LINE creates no expense
            -> not my/wrong document -> existing reject/cancel action
  -> unreadable / multi-document
       -> request a clearer or one-document image
  -> quotation / PO / booking / non-financial
       -> block expense route and show the correct bounded guidance
```

### 9.2 First blocking card for a check bill

The card replaces the misleading green audit summary as the dominant state. Field extraction may appear below as “ข้อมูลที่ระบบอ่านได้ — ยังไม่บันทึก” but must not visually imply document acceptance.

Required copy:

**Heading**

> เอกสารนี้ยังไม่ใช่ใบเสร็จ

**Explanation**

> เช็กบิลแสดงรายการและยอดที่ต้องจ่าย แต่ยังไม่ยืนยันว่าร้านรับเงินแล้ว เอกสารนี้ใช้เป็นหลักฐานยืนยันค่าใช้จ่ายโดยลำพังไม่ได้

**Question**

> คุณจ่ายเงินรายการนี้แล้วหรือยัง?

**Actions**

- Primary: `จ่ายแล้ว`
- Secondary: `ยังไม่ได้จ่าย`
- Tertiary link: `มีใบเสร็จฉบับสุดท้าย — อัปโหลดแทน`
- Reviewer-only disclosure: `ระบบอ่านเอกสารผิด? ให้ฝ่ายบัญชีตรวจ`

The UI must not show `จัดทำใบทดแทน`, `ยืนยัน override`, or tax-state selectors before the user answers the plain-language question.

### 9.3 “จ่ายแล้ว” path

Ask:

> หลังจ่ายเงิน ร้านออกใบเสร็จให้อีกใบไหม?

Actions:

- `มี — อัปโหลดใบเสร็จ` opens the existing receipt upload.
- `ไม่มี — ใช้หลักฐานอื่น` continues to the paid-without-receipt route.

The next screen shows a compact fact confirmation, prefilled only from bounded suggested fields and never committed without human confirmation:

- วันที่ใช้จ่าย;
- ยอดรวม;
- รายละเอียดค่าใช้จ่าย;
- หมวดค่าใช้จ่าย; and
- actual business-purpose statement.

The screen says:

> ตรวจว่าข้อมูลตรงกับรายการจริงหรือไม่ คุณแก้ไขได้ก่อนบันทึก

The original check bill is automatically selected as **หลักฐานประกอบ**. It remains the same immutable attachment; the product does not rewrite or pretend it was a receipt.

Then ask for payment evidence using examples that match the payment method:

- card: card slip or matching bank/card transaction;
- transfer: transfer slip or matching bank transaction;
- cash: attach separate actual payment evidence; the existing printable payment voucher is only a blank form until completed and supported by real payment evidence.

The primary action is:

> ไปจัดทำใบรับรองแทนใบเสร็จ

When any confirmed date/amount/description/category is dirty, that one visible action performs two explicit application steps:

1. save the reviewed facts through the existing review-fields API and reload the returned/current `updatedAt`; then
2. call substitute preparation with the explicit check-bill route and that new optimistic revision.

Preparation never accepts unsaved reviewed facts or trusts client-calculated totals. The API validates the raw `ORDER_OR_CHECK_BILL` classification, route flag, permission, policy, evidence, and optimistic revision. It commits the route resolution, non-claimable tax state, and prepared evidence atomically. If step 1 succeeds and step 2 fails, the reviewed facts remain safely saved while the item stays a blocked check bill; the same card offers `ลองไปต่ออีกครั้ง` and must not ask the user to type them again.

On success, reuse the current expense and deep-link to the dedicated wizard. Do not create a second expense.

### 9.4 “ยังไม่ได้จ่าย” path

Web shows:

> บันทึกร่างไว้แล้ว เมื่อจ่ายเงินแล้วให้อัปโหลดใบเสร็จฉบับสุดท้าย หรือกลับมาเลือก “จ่ายแล้วแต่ไม่มีใบเสร็จ”

The record remains `DRAFT`/`NEEDS_REVIEW`; substitute preparation, mark-ready, and confirmation remain unavailable. This path does not record payment.

LINE has not created an expense at this point. It keeps the uploaded file in the existing bounded pending-media store while asking the three-way question. If the user answers `ยังไม่ได้จ่าย`, the pending question is closed and no expense draft is created. If the user answers `มีใบเสร็จฉบับสุดท้าย`, the check bill is not promoted; the next valid receipt follows normal capture. Only `จ่ายแล้ว แต่ไม่มีใบเสร็จ` creates one expense draft from the parked file and starts the substitute continuation.

### 9.5 Non-reviewer state

Users without `expense.review` may see the classification and upload a final receipt if their existing upload/ownership permissions allow it. They may not resolve classification or route the expense into substitute preparation.

Copy:

> บันทึกรายการไว้แล้ว ฝ่ายบัญชีต้องตรวจเอกสารนี้ก่อนดำเนินการต่อ

Do not show an enabled action they cannot complete. If an existing reviewer notification already exists, reuse it; this slice does not invent a new notification workflow.

### 9.6 Reviewer “system read it wrong” path

Keep the existing explicit finance resolution, but move it under a secondary disclosure. It is for a real misclassification, not a workaround for a genuine check bill.

Required controls:

- select the actual document type;
- enter a 1–500 character reason;
- acknowledge that the original AI classification remains in audit history; and
- submit through the existing permission-checked endpoint.

Copy must say `ยืนยันว่าเอกสารนี้เป็นใบเสร็จจริง` rather than `override`.

### 9.7 Mobile recovery presentation

At 390 × 844, the check-bill explanation, payment question, and first answer must be reachable without a sticky footer covering them. While this question is unresolved:

- suppress the generic step footer and its stale `ถัดไป` blocker;
- do not repeat `ย้อนกลับ` inside both the card and footer;
- keep cancel/delete under a secondary `ตัวเลือกเพิ่มเติม` disclosure;
- place the recovery card before extracted accounting detail; and
- after an answer, show only actions valid for that answer and update the status text immediately.

The interface must never say `เลือกคำตอบด้านบน` when the answers are below the fold or already selected.

### 9.8 LINE low-confidence interaction

The first LINE reply contains one short reason, one payment question, and three tappable Quick Reply choices. Numbered text remains as a fallback and maps to the same existing `1/2/3` parser; tapping a choice does not mutate anything beyond sending that answer.

After `จ่ายแล้ว แต่ไม่ได้ใบเสร็จ`, confirm that one draft was created and ask only the next required question. Do not repeat every accounting blocker, policy paragraph, VAT caveat, and web link on each turn. A hard forbidden or ineligible result may still show its complete bounded explanation.

After `ยังไม่ได้จ่าย` or `มีใบเสร็จ จะส่งใหม่`, explicitly say that no expense was created from the check bill.

### 9.9 Wizard mobile recovery

An actionable prerequisite appears before long legal detail. On narrow screens, its repair text and button stack vertically and the button spans the available width. Supporting text must not be squeezed beside an action.

The wizard leads with a short visible limitation: this certificate is not a tax invoice and cannot support an input-VAT claim. Additional legal/tax detail uses a native disclosure while the required acknowledgement remains explicit. A blocked primary action names the missing fact and offers the direct repair path.

## 10. Route Matrix

| Detected state | Direct normal expense | Substitute route | Primary user guidance |
| --- | --- | --- | --- |
| Receipt with positive total and settlement evidence | Allowed after normal review | Not needed | ตรวจข้อมูลแล้วส่งต่อ |
| Tax invoice/receipt issued but later unavailable or materially incomplete | Normal path if current valid copy exists | Allowed only with supported reason; no input-VAT claim from internal certificate | ขอสำเนาจากร้านก่อน หรือใช้ใบทดแทนเมื่อเข้าเงื่อนไข |
| Check bill with total but no settlement evidence | Blocked as receipt | Allowed only after explicit paid-without-receipt resolution and evidence/policy checks | จ่ายแล้วหรือยัง? |
| Check bill with user/guest signature only | Blocked as receipt | Same as unsigned check bill | ลายเซ็นของผู้ซื้อไม่ยืนยันว่าร้านรับเงินแล้ว |
| Check bill stamped/signed `PAID` by issuer with deterministic settlement signals | Re-run receipt gate; may become normal supporting/receipt evidence, subject to review | Available only if final receipt is still unavailable and rules permit | ตรวจเอกสารฉบับล่าสุด |
| Supplier invoice/bill due | Reviewable bill/AP candidate under existing rules | Not until a real paid-without-receipt situation exists | เอกสารนี้ยังเป็นยอดค้างจ่าย |
| Quotation / PO / appointment / booking | Blocked | Blocked | Explain the correct non-expense destination |
| Unreadable / multi-document | Blocked | Blocked | Retake one clear document per image |
| Transfer slip only | Supporting/payment evidence only | Can satisfy payment proof for an eligible expense | ต้องมีรายละเอียดค่าใช้จ่ายแยกต่างหาก |

## 11. Business Rules

1. `ORDER_OR_CHECK_BILL` is never accepted as `RECEIPT` without deterministic settlement evidence.
2. A guest/customer/employee signature alone is not merchant receipt or settlement evidence.
3. A check bill may be retained as supporting evidence for a real expense.
4. Routing a check bill to the substitute journey requires:
   - current mutable expense status;
   - `expense.review`;
   - a structurally valid `ROUTED_TO_SUBSTITUTE_RECEIPT` resolution;
   - explicit acknowledgement that payment occurred;
   - reviewed positive THB amount, date, description, and category;
   - `SUPPORTING_ONLY` tax evidence and `NON_CLAIMABLE` input VAT;
   - a supported missing-receipt reason;
   - current payer/approval policy; and
   - separate actual payment evidence for every method, including cash and permissive/missing cash policy.
5. A routing resolution never changes or deletes the original classification.
6. A new extraction/classification revision invalidates a stale routing resolution until reviewed again.
7. A route resolution may unblock mark-ready, but final confirmation still requires a current `ISSUED` substitute artifact under existing rules.
8. Quotation, purchase order, delivery note, appointment, booking, reservation, signature image, non-financial image, unreadable image, ambiguous image, and multi-document image remain ineligible even when a finance override exists, unless a later owner-approved spec changes that product rule.
9. The system does not create a duplicate expense to recover from the check-bill state.
10. The known business-rule failure must include a stable machine code and actionable Thai mapping.
11. LINE must not create an expense merely because a check bill was uploaded. Expense creation happens only after the user explicitly confirms the paid/no-final-receipt route, or after a later valid receipt follows the normal capture path.

## 12. Shared Decision Contract

Add a bounded shared contract in `@watchdog-bms/contracts` and make it the input to both web rendering and API enforcement.

```ts
type ExpenseEvidenceDecision = {
  status: 'ACCEPTED' | 'ACTION_REQUIRED' | 'BLOCKED' | 'NEEDS_REVIEW';
  reasonCode:
    | 'CHECK_BILL_MISSING_SETTLEMENT'
    | 'FINAL_RECEIPT_RECOMMENDED'
    | 'PAYMENT_EVIDENCE_REQUIRED'
    | 'NON_EXPENSE_DOCUMENT'
    | 'UNREADABLE_DOCUMENT'
    | 'MULTI_DOCUMENT'
    | 'PROVIDER_UNAVAILABLE'
    | null;
  documentKind: BusinessDocumentKind | null;
  allowedActions: Array<
    | 'UPLOAD_FINAL_RECEIPT'
    | 'ROUTE_TO_SUBSTITUTE'
    | 'KEEP_DRAFT_UNPAID'
    | 'FINANCE_CORRECT_CLASSIFICATION'
    | 'REUPLOAD_CLEAR_IMAGE'
    | 'REJECT_OR_CANCEL'
  >;
};
```

Rules:

- the evaluator is pure and deterministic;
- allowed actions describe business capabilities, not button visibility;
- web still applies permission/ownership checks before rendering an action;
- API re-evaluates from current server state before every mutation;
- unknown states fail closed to `NEEDS_REVIEW`; and
- no raw OCR text or model output enters this contract.

## 13. Routing Resolution Contract

Add a distinct bounded resolution instead of misusing the generic finance override:

```ts
type ExpenseEvidenceRoutingResolution = {
  outcome: 'ROUTED_TO_SUBSTITUTE_RECEIPT';
  acknowledgedPaid: true;
  reasonCode: 'RECEIPT_UNAVAILABLE' | 'RECEIPT_MATERIALLY_INCOMPLETE';
  classificationFingerprint: string;
  resolvedExpenseTotal: string;
  resolvedByUserId: string;
  resolvedAt: string;
};
```

Persist it as a bounded additive member of the current AI/review summary structure so no schema migration is required in the first slice. The server computes the classification fingerprint from bounded classification fields; clients never supply a trusted fingerprint, actor, or timestamp.

If later reporting requires querying route outcomes at scale, promote this bounded resolution to an explicit table/column through a separate migration spec. Do not add a speculative schema change now.

## 14. API Behavior

### 14.1 Resolve the route atomically during preparation

The existing substitute-prepare endpoint accepts additive `routeCheckBill: true`. It is not a generic override and is accepted only when the current raw classification is `ORDER_OR_CHECK_BILL`.

The use case loads the company/branch-scoped expense, checks `expense.review`, mutable status, positive reviewed facts, payment/evidence/policy prerequisites, and `expectedExpenseUpdatedAt`. The existing advisory-lock/idempotency/CAS transaction then creates `PREPARED` evidence, stores `ROUTED_TO_SUBSTITUTE_RECEIPT`, and sets `SUPPORTING_ONLY` plus `NON_CLAIMABLE` together. It preserves the original source type, attachment, and raw classification. A failure before commit leaves the expense as a blocked check bill and creates no partial route state.

### 14.2 Prepare the substitute receipt

The existing prepare endpoint remains canonical. Eligibility changes only for `ORDER_OR_CHECK_BILL`:

- raw kind remains ineligible by default;
- it becomes eligible only when a current, valid routing resolution exists and all existing substitute prerequisites pass;
- all other raw ineligible kinds remain blocked.

Every known eligibility failure must throw:

```ts
new BadRequestException({ code: issue.code, message: issue.message })
```

The API must never return a generic un-coded 400 for a known business eligibility issue.

### 14.3 Expense detail/extraction response

Expose `evidenceDecision` additively or make the shared evaluator inputs complete in `ExpenseDetail`. The implementation must choose one approach and use it consistently; the backend remains authoritative either way.

## 15. Web Behavior

### 15.1 Canonical preparation path

- Remove/hide the inline pre-prepare substitute form from `DocumentReviewSection`.
- Keep current evidence status/history and links for already-prepared certificates.
- Send every new preparation through `/expenses/substitute-receipts/new?expenseId=...`.
- Update dedicated wizard candidate eligibility to accept a check bill only when the valid routing resolution exists.

This removes the current duplicate form and its drift from API rules.

### 15.2 Stepper behavior

- A check-bill action card appears immediately after extraction and remains visible on every relevant step.
- `ถัดไป` may navigate for review, but the user must not reach a final review screen that visually implies the document is ready.
- `ส่งตรวจสอบ` and `ยืนยัน` remain blocked until a valid route resolution or true finance correction exists.
- The stepper marks the document step as `ต้องทำต่อ`, not as green/passed.

### 15.3 Loading and request feedback

- Disable only the action being submitted.
- Button copy changes to a specific progress phrase, for example `กำลังเปิดทางจัดทำใบทดแทน...`.
- On success, navigate to the canonical wizard and retain the original expense ID.
- On failure, keep the card expanded, keep entered values, focus the inline error heading, and offer the repair action.
- Never show a generic toast without a persistent inline message for this route.

### 15.4 Mobile and accessibility

- Minimum body text: 16 px on action cards; helper text no smaller than 14 px.
- Touch target: at least 44 × 44 px.
- Primary and secondary actions stack vertically on narrow screens.
- Plain heading and status text accompany every icon/colour.
- Focus moves to the next question heading, not directly into an input that opens the mobile keyboard.
- Back returns to the previous question without clearing data.
- Screen readers receive `aria-live="polite"` for status and `role="alert"` for blocking failures.
- Reduced-motion preferences are respected.
- The recovery question is not hidden by sticky navigation at 390 × 844.
- Mobile prerequisite rows stack rather than compress explanatory text beside an action.
- Destructive or exceptional actions are visually secondary to the one recovery decision.

## 16. Permissions and Audit

- View follows current `expense.read_*`/ownership rules.
- Upload final receipt follows current receipt-upload ownership/permission rules.
- Route resolution requires `expense.review` and branch scope.
- Substitute prepare remains `expense.review`.
- Payer certification remains bound to the recorded payer.
- Approval remains `expense.confirm` plus company approval policy.
- Reject/cancel/delete remain existing separate permission-checked actions.
- Audit the route resolution as HIGH risk; do not audit raw OCR, image bytes, object keys, signed URLs, or free-form provider output.
- A finance correction and a substitute routing resolution are distinct audit actions.

## 17. Error and Empty States

| State | Required behavior |
| --- | --- |
| Classification provider unavailable | Keep manual-review draft; do not call it a check bill without evidence |
| Payer list unavailable | Explain that people could not be loaded and show retry; do not enable prepare |
| Company approval policy incomplete | Name the missing setup and link authorized users to settings |
| No expense category | Explain that a category is required and link authorized users to category setup |
| Stale expense revision | Preserve selections, reload current detail, and ask the user to review changed facts |
| Payment proof missing | Show examples matching the selected payment method |
| User lacks review permission | Show waiting-for-finance copy; hide route mutation action |
| Route resolution stale after re-extraction | Return to the action card with the latest document decision |
| Known API eligibility blocker | Render code-specific Thai next to the action |
| Unknown API 400 | Keep current safe generic fallback and capture request ID for support |

## 18. Observability

Record bounded events/metrics only:

- extraction decision by `documentKind` and `reasonCode`;
- action-card impression;
- action selected (`upload_final`, `paid_no_receipt`, `unpaid_no_expense`, `finance_correct`);
- route-resolution success/failure code;
- generic-400 fallback count for substitute preparation;
- dedicated-wizard completion/abandonment from this entry point; and
- repeated-click count while an action is pending.

Success indicators after rollout:

- zero `classification_ineligible`/`document_kind_ineligible` requests originating from an enabled web prepare button;
- near-zero generic 400 fallback for substitute eligibility;
- lower time from check-bill detection to a valid next action; and
- no increase in duplicate expense creation.

## 19. Acceptance Criteria

### User comprehension

- [ ] A first-time mobile user can answer within five seconds why the file cannot be used alone.
- [ ] The first visible question is “คุณจ่ายเงินรายการนี้แล้วหรือยัง?” rather than an accounting selector.
- [ ] The user sees one recommended next action and can go back without losing work.
- [ ] The copy never blames the user or calls a real expense impossible to record.

### Product rules

- [ ] A restaurant check bill with a total but no settlement evidence is rejected as a receipt before normal review completion.
- [ ] A customer/guest signature on the check bill does not upgrade it to receipt.
- [ ] A final receipt upload returns to the normal extraction/review path.
- [ ] A paid-without-receipt choice reuses the current expense, preserves the original attachment, and enters the dedicated substitute wizard.
- [ ] The check bill is supporting evidence, not input-VAT evidence.
- [ ] Non-cash payment still requires separate payment evidence.
- [ ] Cash check bills require separate real payment proof; ordinary cash policy stays unchanged.
- [ ] No duplicate expense is created by the recovery path.

### Architecture and safety

- [ ] Web and API use the same bounded evidence decision.
- [ ] API revalidates current state, company, branch, permission, status, and revision.
- [ ] Only a current structurally valid route resolution permits an `ORDER_OR_CHECK_BILL` substitute path.
- [ ] All other raw ineligible document kinds remain blocked.
- [ ] Every known substitute eligibility failure returns a stable machine code.
- [ ] No partial route or certificate write survives a rejected request.
- [ ] Original classification and a bounded HIGH-risk resolution audit remain visible.

### UX quality

- [ ] No unsupported inline prepare form is visible.
- [ ] No disabled action is unexplained.
- [ ] No known business blocker is toast-only.
- [ ] Mobile actions meet touch-size and readable-text requirements.
- [ ] Loading, retry, stale, forbidden, and policy-incomplete states have actionable copy.
- [ ] At 390 × 844, no sticky footer covers the explanation, payment question, or answer actions.
- [ ] The footer never asks for an answer after one has been selected.
- [ ] LINE offers three tappable answers and keeps the paid continuation to one confirmation plus one next question.
- [ ] Wizard repair copy and action stack legibly on mobile; secondary legal detail is progressively disclosed.

## 20. Test Scenarios

1. Exact restaurant check bill: vendor/tax ID/VAT/total due present, no paid signal → `ACTION_REQUIRED/CHECK_BILL_MISSING_SETTLEMENT`.
2. Same image with guest signature only → unchanged check-bill decision.
3. Merchant-issued final receipt with paid signal → normal receipt path.
4. Check bill + card slip, reviewed positive amount/category, explicit paid-without-receipt resolution → dedicated wizard eligible.
5. Check bill + transfer method but no transfer proof → payment-evidence blocker shown before prepare.
6. Cash check bill under permissive or missing policy → separate payment evidence required; payer/approval/signature rules remain.
7. Cash check bill under strict policy → separate payment evidence required.
8. Finance correction says image is actually a receipt, with reason → normal review can continue and audit retains original classification.
9. Quotation with finance override → still cannot route to substitute.
10. Re-extraction changes classification after route resolution → resolution becomes stale and prepare is blocked with actionable code.
11. Two tabs update the same expense → second route request gets stale-reload and no partial mutation.
12. User without `expense.review` → sees waiting state and cannot call resolution endpoint.
13. API direct call without branch scope → forbidden.
14. Mobile 390 × 844 → primary action, explanation, and back navigation are visible without horizontal scrolling.
15. Browser refresh on each question → server-persisted state and safe local draft facts restore correctly.
16. Known business failure → code-specific Thai; unknown 400 → safe generic fallback plus request ID.
17. LINE check-bill prompt → three Quick Reply actions and numbered fallback resolve through the same pending decision.
18. LINE paid/no-receipt → creates exactly one draft and replies with one next question rather than the full blocker dump.
19. Mobile blocked wizard → prerequisite text is readable at normal line width and its repair action is full-width.

## 21. Rollout and Compatibility

- Contract additions are additive.
- No database migration is expected for the first slice.
- Deploy API support before or together with web; an older web client must continue to receive safe current behavior.
- The web change must not enable the new route until the API contract is live.
- UAT must include real Thai restaurant check bills, final receipts, card slips, transfer slips, cash-policy variants, and the exact mobile viewport from the incident.
- Production release follows `docs/runbooks/uat-production-v2-deployment.md`; exact UAT, READY, Production, signed-result, and customer-OPEN evidence are mandatory.

## 22. Open Questions

No blocker is required for the first implementation slice. Proposed defaults are:

1. Reuse the existing web expense; on LINE, create the single expense only after the paid/no-final-receipt answer.
2. Store the bounded route resolution additively in the current review summary; revisit schema only when reporting needs justify it.
3. LINE may collect the decision and prepare the same expense, while signing and approval remain web-owned.
4. Apply the 2026-08-27 check-bill-only separate-proof requirement; keep ordinary cash policy unchanged.
