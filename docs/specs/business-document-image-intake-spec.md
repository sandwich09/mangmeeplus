# Business Document Image Intake Spec

Status: Implemented and locally verified for items 09, 10B, 08, and 15A; live Thai-document calibration smoke remains before production-ready claim (owner decision 2026-07-13)

Linked plan: [[plans/business-document-image-intake-plan|Business Document Image Intake Plan]]

## 1. Product Outcome

WatchDog must identify what an uploaded image represents before choosing an expense, accounting, CRM, signature, clarification, or unsupported path.

The immediate defect is that an order/check slip containing item names and quantities but no price or total can be treated as a receipt. The broader outcome is one bounded intake decision for receipts, bills, quotations, appointment cards, booking confirmations, transfer slips, signatures, other business documents, non-financial photos, unreadable images, and multi-document images.

Classification is advisory until deterministic API gates accept it. An image classification alone never confirms an expense, issues a quotation, records a payment, or creates/confirms a booking.

## 2. Users and Channels

- Linked internal user through the WatchDog shared LINE OA.
- Web user intentionally uploading evidence in Expenses.
- Customer through a company CRM LINE OA. Customer media remains CRM conversation evidence; this follow-up does not merge the customer-OA agent with the internal shared-OA agent.
- Finance/accountant/sales/staff reviewing the suggested destination in web.

## 3. Business Classification

Keep the global image/document classification separate from expense `SourceDocumentType`.

### 3.1 Content kind

```text
DOCUMENT
MULTI_DOCUMENT
NON_DOCUMENT_IMAGE
UNREADABLE
AMBIGUOUS
```

### 3.2 Document family

```text
EXPENSE_EVIDENCE
COMMERCIAL_DOCUMENT
PAYMENT_EVIDENCE
SCHEDULING_DOCUMENT
SIGNATURE_ASSET
OTHER_BUSINESS_DOCUMENT
NON_BUSINESS
```

### 3.3 Document kind

```text
RECEIPT
TAX_INVOICE
SUPPLIER_INVOICE_OR_BILL
ORDER_OR_CHECK_BILL
QUOTATION
PURCHASE_ORDER
DELIVERY_NOTE
TRANSFER_SLIP
MARKETPLACE_ORDER
HANDWRITTEN_CASH_BILL
APPOINTMENT_CARD
BOOKING_CONFIRMATION
RESERVATION_CONFIRMATION
SIGNATURE_IMAGE
OTHER_BUSINESS_DOCUMENT
NON_FINANCIAL_IMAGE
NEEDS_REVIEW
```

### 3.4 Additional dimensions

```text
businessDirection:
  PURCHASE_EXPENSE | SALES_RECEIVABLE | CUSTOMER_INBOUND | UNKNOWN

transactionState:
  PROPOSED | ORDERED | DUE | PAID | SCHEDULED | CONFIRMED | CANCELLED | UNKNOWN

evidenceRoles:
  EXPENSE_SUPPORT | TAX_EVIDENCE_CANDIDATE | PAYMENT_PROOF |
  COMMERCIAL_PROPOSAL | SCHEDULING_PROOF | CONVERSATION_ATTACHMENT
```

One image can carry more than one evidence role. For example, a paid hotel reservation may be scheduling proof and expense support. The intake decision must still choose one primary route and must not create multiple domain records automatically.

#### 3.4.1 Business direction perspective (owner update 2026-07-14)

`businessDirection` is judged from the perspective of the UPLOADING tenant, never
from the document issuer's voice (a receipt always "speaks" as the seller). Rules,
grounded in `docs/research/thai-document-conventions-receipt-ocr.md`:

1. Uploader identity matches the issuer/header block → `SALES_RECEIVABLE` (the
   tenant's own sales document; acceptance scenario 22).
2. Uploader identity matches the customer field (ลูกค้า/นาม/ผู้ซื้อ/ได้รับเงินจาก/
   Bill to) → `PURCHASE_EXPENSE`.
3. Uploader appears nowhere on the document (retail POS slip, abbreviated tax
   invoice — which legally omits the buyer per ม.86/6 — or a cash bill naming another
   or no customer): supplier-issued settled evidence arriving through an
   expense-capture channel defaults to `PURCHASE_EXPENSE`; the named issuer is the
   counterparty.
4. Truly ambiguous (issuer unreadable, or the document appears to be the tenant's own
   template/series) → `UNKNOWN` with `AMBIGUOUS_BUSINESS_DIRECTION`; never guess
   `SALES_RECEIVABLE` merely because the document is written in the seller's voice.

Clarification to §5.1(2), same research: a document TITLE of ใบเสร็จรับเงิน/ใบรับเงิน/
RECEIPT or บิลเงินสด/CASH SALE is itself settlement evidence (Revenue Code ม.105
requires a ใบรับ to be issued at the moment money is received). ใบกำกับภาษีอย่างย่อ is
settled-by-convention at retail point of sale and definitively settled when combined
with ใบเสร็จรับเงิน. A standalone full ใบกำกับภาษี for goods is NOT settlement evidence
(tax point = delivery). ใบแจ้งหนี้/ใบวางบิล/ใบเสนอราคา/ใบส่งของ/เช็คบิล titles are
anti-signals.

## 4. Classification Result Contract

The existing OCR response should be extended additively with one bounded classification object rather than building a second provider registry or database-writing AI service.

```ts
type BusinessDocumentClassification = {
  contentKind: ContentKind;
  documentFamily: DocumentFamily;
  documentKind: DocumentKind;
  businessDirection: BusinessDirection;
  transactionState: TransactionState;
  evidenceRoles: EvidenceRole[];
  confidence: number;
  evidenceSignals: string[];
  missingRequiredSignals: BusinessDocumentReasonCode[];
  contradictionSignals: BusinessDocumentReasonCode[];
  requiresClarification: boolean;
};
```

Evidence signals are short bounded OCR text spans or semantic labels. The parser must reject unknown enum values, clamp confidence, bound all arrays, and never retain raw model output. Numeric evidence used by a deterministic gate must still exist in the stage-1 OCR text after the existing cross-check.

## 5. Deterministic Gates

The model may propose or downgrade a type. It cannot bypass these gates, and deterministic code must never upgrade uncertain evidence to a stronger document type.

### 5.1 Receipt

`RECEIPT` requires:

1. A positive printed transaction total or amount received, verified against OCR text; and
2. Receipt/settlement evidence such as an explicit receipt title, paid/received state, payment method, cash received, change, or final POS settlement; and
3. At least one transaction anchor: issuer/vendor, date/time, or receipt/reference number.

Items and quantities without a price or transaction total are never a receipt. Unit/menu prices without a transaction-specific total are not sufficient. A check bill with a total but no settlement evidence is `SUPPLIER_INVOICE_OR_BILL` or `ORDER_OR_CHECK_BILL`, not `RECEIPT`.

### 5.2 Tax invoice

`TAX_INVOICE` requires a positive printed total plus tax-invoice/VAT context. Missing vendor tax id, document number, tax base, or VAT amount may keep the document-kind candidate but must keep tax evidence and input-VAT usability in `NEEDS_REVIEW`.

### 5.3 Supplier invoice or bill

Requires an issuer/provider and a positive payable total or priced transaction lines. Paid evidence is not required because the document can represent an amount due. It may create a reviewable expense/AP candidate only when business direction is purchase/expense or user context confirms that direction.

### 5.4 Transfer slip

Requires a positive transferred amount plus sender/recipient/bank/account/time/reference evidence. It is payment support only; it never supplies VAT, vendor invoice, or final payment-record truth by itself.

### 5.5 Order/check bill

An item/service list with quantity, table, queue, or order context but without a monetary total is `ORDER_OR_CHECK_BILL` with `MISSING_MONETARY_AMOUNT`. It must not create an expense draft automatically. The user should send the final receipt/bill containing an amount or explicitly choose a manual supporting-evidence path.

### 5.6 Commercial and scheduling documents

- `QUOTATION` is proposed commercial evidence, even if it contains prices and a total.
- `APPOINTMENT_CARD` requires a specific scheduled date/time and party/provider/service context; price is optional.
- `BOOKING_CONFIRMATION` or `RESERVATION_CONFIRMATION` requires confirmation/reference plus resource/provider and scheduled dates/times.
- A monetary deposit on a quotation, appointment, or booking image does not turn it into a receipt unless separate settlement evidence is visibly present.

These kinds can produce review guidance and web deep links only in this slice. They do not auto-create official quotations, appointments, or bookings.

### 5.7 Image quality and multiplicity

- `UNREADABLE`: cropped, blurred, glared, too small, or insufficient OCR coverage. Ask for a clearer image; do not guess.
- `MULTI_DOCUMENT`: more than one independent document is visible. Do not merge vendors, dates, totals, or routes. Ask for one document per image in the first slice.
- `NON_FINANCIAL_IMAGE`: no document structure or business-record evidence. No expense draft or business mutation.

## 6. Reason Codes

```text
NO_DOCUMENT_STRUCTURE
UNREADABLE_OR_CROPPED
MULTIPLE_DOCUMENTS
LOW_CLASSIFICATION_CONFIDENCE
CONTRADICTORY_SIGNALS
QUANTITY_ONLY
MISSING_MONETARY_AMOUNT
MISSING_TRANSACTION_TOTAL
MISSING_PAYMENT_EVIDENCE
ORDER_ONLY
MISSING_VENDOR
MISSING_DOCUMENT_NUMBER
MISSING_VENDOR_TAX_ID
MISSING_TAX_BASE_OR_VAT
QUOTATION_NOT_TRANSACTION
PAYMENT_EVIDENCE_ONLY
MISSING_SCHEDULED_TIME
MISSING_PARTY_OR_PROVIDER
MISSING_BOOKING_REFERENCE
AMBIGUOUS_BUSINESS_DIRECTION
CHANNEL_SCOPE_MISMATCH
TARGET_PERMISSION_MISSING
TARGET_MODULE_DISABLED
OCR_UNAVAILABLE
HUMAN_REVIEW_REQUIRED
```

`NEEDS_REVIEW` is a workflow outcome. It must not be the only representation for document kind, image quality, extraction failure, tax status, and ambiguity reason.

## 7. Route Matrix

| Classification | Shared employee LINE OA | Web Expenses upload | Company customer LINE OA |
| --- | --- | --- | --- |
| Receipt/tax invoice/supplier bill/handwritten bill/marketplace order with required amount evidence | Create expense draft only after permission and evidence gates; web review required | Keep explicit upload draft, apply only accepted fields, show classification | Keep CRM attachment; no expense mutation from customer agent |
| Transfer slip | Expense/payment-support draft only; never final payment | Supporting evidence with review | Existing payment-proof review queue only |
| Order/check bill with no amount | Explain missing amount; no expense draft | Keep explicit upload draft but return `not_expense_document`; apply no money fields; block ready/confirm until finance resolution | Conversation attachment only |
| Quotation | No expense; show accounting/sales review guidance | Keep explicit upload draft/evidence, apply no expense fields, and block ready/confirm until finance resolution | Conversation attachment/review only; never issue quotation |
| Appointment/booking/reservation | No expense; show `/bookings` review guidance | No expense auto-key | Conversation attachment; existing proposal + explicit-confirmation gates remain authoritative |
| Signature image | Existing pending owner-approval ticket | Existing signature upload path | Conversation attachment unless customer flow explicitly supports it |
| Non-financial/unreadable/multi-document/ambiguous | Clarify or ask re-upload; no expense | Keep explicit draft/evidence, apply nothing, show reason, and block ready/confirm until finance resolution | Conversation attachment plus staff review |
| Provider unavailable | Uncaptioned/ambiguous media must enter clarification, never expense fallback; explicit expense context may use existing manual-review confirmation | Existing manual review remains available because user chose Expenses | Keep conversation attachment; no automated mutation |

## 8. Shared Employee LINE Sequence

```text
download media once
  -> semantic router classifies signature/question/mutation/business-document family
  -> Typhoon reads image and neutral stage-2 prompt returns classification + fields
  -> no usable total after that pass: ONE Bedrock vision re-read of the same image, re-run stage 2,
     and keep the re-read only when it clears the same total gate (otherwise the first reading stands)
  -> numeric cross-check validates printed values
  -> deterministic API decision combines route, classification, caption, permission, and availability
     -> eligible expense: initialize upload, store/link attachment, create draft, apply validated fields
     -> signature: existing pending ticket path
     -> quotation/scheduling/order/non-business: no expense; bounded guidance/clarification
     -> unavailable/uncertain: existing tenant-scoped pending-media clarification path
```

No expense record should exist before the decision accepts an expense family, except an explicit web Expenses upload where the user already selected the expense destination.

## 9. Permission and Mutation Boundaries

- Expense draft requires existing expense capture permission and company/branch context.
- After `NOT_EXPENSE_DOCUMENT` the read fields are stored under `aiVerificationSummaryJson.suggestedFields` and shown to the reviewer, never applied. Nothing about the draft, its status, or its blocks changes; the reviewer chooses to copy them into the empty fields, and their own typed values are never overwritten. "Apply no money fields" continues to mean the server writes none.
- An explicit web Expenses upload may retain its draft and attachment after `NOT_EXPENSE_DOCUMENT`, but both mark-ready and confirm fail closed until one valid `classificationResolution` exists. Resolution requires `expense.review`, explicit acknowledgement, a non-`NEEDS_REVIEW` expense `SourceDocumentType`, and a trimmed 1–500 character reason. Keep the original `NOT_EXPENSE_DOCUMENT` status/classification visible; store one current bounded resolution and use append-only HIGH-risk audit for history. After resolution, a reviewer can use the reviewer-protected mark-ready route even when the role does not also hold `expense.update`; the existing own-draft route remains protected by `expense.update`.
- Ordinary draft updates, a changed document type by itself, malformed resolution JSON, or a legacy `HUMAN_OVERRIDDEN` status do not unblock the record. Web mirrors the server boundary: non-reviewers see a waiting-for-finance state; reviewers see the explicit override action; the original classification and finance resolution remain visible after reload.
- Quotation guidance must not create/issue/approve/void an accounting quotation. Any later import preview would require `accounting.quotation.create`; CRM linking also requires `crm.quotation.link`.
- Booking guidance uses runtime `crm.booking.read`; any later booking creation still requires `crm.booking.create`, customer/service/branch/staff/slot validation, and explicit confirmation.
- Transfer-slip classification never records payment or reconciles a bank transaction.
- AI Gateway remains database-free. API/source modules re-check tenant, permission, branch, state, idempotency, audit, and final-mutation rules.
- Raw image bytes, OCR text, provider output, object keys, secrets, and signed URLs must not enter audit/outbox payloads.

## 10. Failure and Privacy Behavior

- Router and OCR disagreement downgrades to clarification unless the deterministic gate can safely accept the weaker expense type.
- Router-unavailable uncaptioned media may continue only when OCR returns an expense classification that passes the deterministic expense gate. Captioned media, missing OCR, failed OCR, or rejected classifications still clarify.
- Provider unavailable must not classify arbitrary uncaptioned images as expenses.
- Redelivery remains idempotent by company and LINE message id.
- Non-business images should not be retained beyond an existing pending-media TTL unless the user explicitly chooses a business purpose.
- Unsupported PDF/media remains manual-review/clarification; no invented classification.
- Image prompt injection is data, never instruction.

## 11. Acceptance Scenarios

1. Receipt with positive total and paid/receipt evidence creates one reviewable expense draft.
2. Food order with item names and quantities but no prices returns `ORDER_OR_CHECK_BILL`, `QUANTITY_ONLY`, and `MISSING_MONETARY_AMOUNT`; no expense draft.
3. Restaurant check bill with total but no paid evidence is a bill/order, not a receipt.
4. Menu/price list with no transaction-specific total is not an expense receipt.
5. Valid tax invoice creates a reviewable expense draft; tax usability remains reviewable.
6. Tax invoice missing tax id/document number remains tax `NEEDS_REVIEW`.
7. Unpaid supplier invoice with a positive total is a bill, not a receipt.
8. Quotation with prices/total produces review guidance and no expense or official quotation.
9. Transfer slip with amount is supporting/payment evidence and does not infer VAT.
10. Appointment card with date/time and no price produces booking review guidance and no mutation.
11. Reservation confirmation with reference/dates produces booking review guidance and no mutation.
12. Paid hotel reservation can carry scheduling and expense-support roles but never creates two records automatically.
13. Food/object/person photo produces no expense draft.
14. Caption `ค่าอาหาร 200 บาท` plus food photo can create a text expense note with supporting image only after explicit expense-context handling; it is not a receipt.
15. Blurred/cropped/glared document asks for a clearer image.
16. Two receipts in one image ask for separate images; totals are never merged.
17. Router/provider unavailable plus uncaptioned image creates no expense draft.
18. Explicit web Expenses upload plus provider unavailable remains a manual-review draft.
19. Same LINE media redelivery produces one decision and at most one target record.
20. Missing target permission produces no draft even when classification is correct.
21. Shared employee OA and company customer OA keep distinct routing and agent boundaries.
22. Customer copy of the company's own invoice remains receivable/conversation evidence, not supplier expense.
23. Model confidence cannot bypass a missing hard-gate signal.
24. Human override records classification history/reason without raw OCR text.
25. Existing signature-image ticket behavior stays unchanged.
26. Manual web upload classified as quotation/order/scheduling/non-financial/unreadable/multi-document cannot mark ready or confirm through UI or direct API.
27. Finance override requires `expense.review`, acknowledgement, selected expense document type, and bounded reason; incidental draft edits do not override.
28. A valid finance resolution preserves the original AI classification, writes a distinct HIGH-risk audit event, and then allows the normal ready/confirm validations.

## 12. Non-Goals for This Slice

- Universal document management or long-term generic attachment inbox.
- Automatic quotation import/issue, supplier RFQ creation, or procurement quotation entity.
- Automatic appointment/booking creation from an image.
- Multi-document segmentation/cropping.
- New OCR provider, provider registry, SDK, database-writing AI agent, or schema migration solely for classification.
- Claiming tax/legal validity or authenticity from image classification.

## 13. Primary References and Product Interpretation

- Revenue Code section 105 requires a receipt when money/payment is received, and section 105 bis lists minimum receipt fields including issuer tax id/name, serial, issue date, amount received, and item/price details where applicable: https://www.rd.go.th/5203.html
- Revenue Code section 86/4 separately lists full tax-invoice fields, including the title, seller/buyer identity, serial, item quantity and value, VAT amount, and issue date: https://www.rd.go.th/5208.html
- Revenue Department guidance on supporting tax-expense evidence uses transaction item value/quantity, net total, receipt/payment evidence, and payment records together: https://www.rd.go.th/fileadmin/download/15277290359.pdf

The product hard gate is intentionally conservative: visible amount plus settlement evidence is required before labeling an image `RECEIPT`. This is an automation-safety rule, not a legal ruling. Legal/tax usability remains a separate human-review decision and cannot be proven by OCR classification alone.
