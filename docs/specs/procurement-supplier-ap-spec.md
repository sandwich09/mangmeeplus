# Procurement, Supplier, and Accounts Payable Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 12.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/procurement-supplier-ap-plan|Procurement, Supplier, and Accounts Payable Plan]]

Owner decisions confirmed on 2026-06-23:

- Direct vendor bills without purchase order are allowed for `FINANCE` by default and must remain audit-visible.
- Matching tolerance starts at zero amount/quantity variance. Any PO/receipt/bill difference requires override permission and reason.
- Supplier full bank account number storage is deferred when encryption/tokenization primitives are absent. Store masked/last4 display data only.

## 2. Goal

Ship the first trustworthy purchase-side operating workflow for WatchDog-BMS:

- Supplier master data.
- Purchase request and purchase order approval.
- Goods receipt linked to inventory stock movements.
- Vendor bill capture, matching, approval, and payable status.
- Supplier payment recording and allocation.
- Accounts payable aging, supplier statement, and purchase status visibility.
- Tax-ready purchase evidence for input VAT, withholding tax, and PP36 review.
- Ledger-ready source posting inputs for vendor bills, supplier payments, and corrections.
- Permission, audit, outbox, web, and read-only AI/LINE hooks.

Item 12 must connect earlier accounting foundations without creating parallel systems. Supplier data extends the item 08 counterparty model. Goods receipt uses item 05 inventory movement behavior. Vendor bills and supplier payments expose source posting inputs to item 10 ledger. Purchase tax facts expose source tax events to item 11 tax workflows.

## 3. Non-goals

- Sales, customer, quotation, invoice, receipt, and customer payment workflow. Item 08 owns them.
- Receipt photo OCR expense workflow. Item 09 owns receipt upload and simple confirmed expenses.
- Double-entry journal generation, chart of accounts, financial statements, or period close implementation. Item 10 owns them.
- Thai tax filing, WHT certificate generation, tax export packages, or final legal tax advice. Item 11 owns them.
- Bank account master, bank statement import, payment matching to bank lines, or reconciliation. Item 13 owns them.
- Reimbursement requests and employee repayment lifecycle. Item 14 owns them.
- Fixed asset capitalization/depreciation. Item 21 owns the asset register; item 12 may flag a bill line as asset candidate only.
- Manufacturing MRP, BOM demand planning, landed cost allocation, lot/batch receiving, warehouse bins, and advanced warehouse automation. Item 22 owns them.
- Supplier portal, external procurement marketplace, EDI, e-invoicing network, or automatic bank transfer execution.
- LINE or AI final approval, purchase issue, goods receipt posting, bill approval, payment recording, voiding, posting, or tax filing mutation.

## 4. User Roles

- Owner: sees purchase commitments, unpaid supplier exposure, overdue AP, approval bottlenecks, tax risk, and high-risk corrections.
- Admin: configures supplier defaults, approval thresholds, payment terms, and purchase settings when granted.
- Staff/requester: creates purchase requests and views own requests.
- Manager: approves purchase requests or purchase orders within threshold and branch scope.
- Inventory user: receives goods against issued purchase orders, resolves quantity discrepancies, and views receiving history.
- Finance/AP: manages suppliers, vendor bills, matching, payable approvals, payment allocations, aging, and supplier statements.
- Accountant: reviews tax treatment, source posting status, ledger/tax exceptions, and accountant export evidence.
- Auditor readonly: reads suppliers, purchase documents, AP records, tax refs, posting status, and audit trail without mutation.
- AI assistant user: asks for summaries, alerts, and explanations through permission-checked read tools only.

## 5. Business Workflow

1. Finance creates or updates supplier profile from the shared counterparty master.
2. Staff creates purchase request with supplier optional, requested items/services, branch, needed date, reason, and budget/category hints.
3. Manager or Owner approves/rejects purchase request based on threshold and branch scope.
4. Finance or authorized purchaser converts approved request to purchase order, or creates direct purchase order when policy allows.
5. Purchase order is submitted, approved when required, then issued with official sequence number.
6. Supplier delivers goods or services.
7. Inventory user posts goods receipt against issued purchase order for stockable lines. Service/non-stock lines can be marked received without inventory movement.
8. System creates immutable inventory stock movements through the inventory module for received stockable quantities.
9. Finance creates vendor bill from purchase order, goods receipt, uploaded evidence, or direct bill policy.
10. System performs two-way or three-way matching against purchase order and goods receipt according to line type and tolerance policy.
11. Finance reviews tax fields: input VAT claimability, supplier tax id/branch, WHT category/rate, PP36 candidate flag, tax invoice refs, and payment terms.
12. Vendor bill is submitted and approved. Approved accounting-relevant bill locks evidence fields and sets posting status `pending`.
13. AP aging and supplier statement update from approved unpaid bills, credits, and payments.
14. Finance records supplier payment against approved bills. Payment records WHT withheld where applicable and creates/updates tax source facts.
15. Supplier payment updates allocations, unpaid amount, AP aging, audit, outbox, and posting status.
16. Item 10 later generates journal entries from deterministic source posting inputs.
17. Item 11 syncs VAT/WHT/PP36 source tax events from approved bills and recorded payments.
18. LINE/AI may summarize open requests, POs, received-not-billed, unpaid bills, overdue AP, and tax review issues with web deep links only.

## 6. Core Business Rules

- Supplier master must reuse or extend item 08 `AccountingCounterparty` with type `VENDOR` or `BOTH`. Do not create a competing vendor master.
- Supplier profile edits do not rewrite issued purchase order, goods receipt, vendor bill, payment, tax, or ledger snapshots.
- Supplier tax id, branch code, payment terms, WHT defaults, input VAT defaults, and bank details are reviewable business data, not trusted blindly for tax filing or payment execution.
- Supplier bank detail visibility requires a dedicated sensitive permission and must be audited when current audit primitives support read access logs.
- Purchase requests are editable only while `DRAFT` or policy-allowed `REJECTED`.
- Purchase orders are editable only while `DRAFT` or policy-allowed `REJECTED`.
- Issued purchase orders lock supplier snapshot, line items, quantities, prices, tax hints, delivery terms, and approval evidence.
- Staff/requester cannot approve their own purchase request unless an explicit policy grants self-approval below a threshold.
- Manager approvals must respect company, branch, role, threshold, and requester/approver separation.
- Purchase order issue requires approval when policy says approval is required.
- Purchase order cancellation is blocked after posted goods receipt or approved vendor bill unless correction policy creates reversal/closure evidence.
- Goods receipt can be posted only against issued purchase order lines or direct receipt policy granted to Finance/Inventory roles.
- Goods receipt posting creates inventory stock movements for stockable lines through inventory application ports or APIs. It must not edit inventory balances directly.
- If item 05 has only generic incoming movement types, goods receipt should use `stock_in` with `referenceType = goods_receipt` and stable source refs.
- Service and non-stock lines do not create stock movements but can be marked received for matching.
- Received quantity cannot exceed ordered quantity plus tolerance unless an authorized override with reason is recorded.
- Goods receipt is append-only after posting. Corrections use void/reversal-ready receipt or additional adjustment document, not silent mutation.
- Vendor bill can be created from purchase order, goods receipt, receipt upload evidence, or direct bill policy.
- Vendor bill approval requires matching result to be accepted or overridden with reason.
- Matching tolerance is configurable per company and may vary by amount, percent, quantity, or line type.
- Vendor bill tax fields must stay explicit: VAT mode, VAT rate, input VAT claim status, WHT category/rate, PP36 candidate, and tax invoice reference where applicable.
- WHT is recognized from supplier payment facts, not only from vendor bill creation.
- Input VAT claimability comes from reviewed bill/tax invoice evidence. Do not assume all VAT is claimable.
- Supplier payment cannot be recorded against unapproved, voided, or blocked bills.
- Partial payment is supported.
- Overpayment is blocked by default in item 12 unless owner creates a supplier credit/unapplied payment policy. Underpayment remains open payable.
- AP aging derives from approved unpaid vendor bills, supplier credits, and payment allocations.
- AP aging buckets must be deterministic from due date, as-of date, and remaining payable amount.
- Approved accounting-relevant vendor bills and recorded supplier payments set posting status `pending`.
- Draft, rejected, and duplicate-only records use posting status `not_required`.
- Item 10 owns journal generation and may update posting status to `posted`, `posting_error`, or `reversed` through source adapters only.
- Item 12 must call ledger closed-period policy before voiding, approving, paying, or correcting accounting-relevant records when item 10 exists.
- Item 12 must expose source tax events or adapters for item 11. It must not duplicate tax period filing state.
- Money, tax, quantity, and matching variance math must be decimal-safe. Do not use JavaScript floating-point math for business totals.
- Company and branch scope are enforced server-side on every route.
- Web permission checks are UX only; backend remains authoritative.
- LINE and AI are read-only for item 12.

## 7. Statuses and Enumerations

Supplier statuses:

```text
ACTIVE
ON_HOLD
ARCHIVED
```

Supplier types:

```text
JURISTIC_PERSON
INDIVIDUAL
FOREIGN
GOVERNMENT
OTHER
```

Purchase request statuses:

```text
DRAFT
PENDING_APPROVAL
APPROVED
REJECTED
CANCELLED
CONVERTED
```

Purchase order statuses:

```text
DRAFT
PENDING_APPROVAL
APPROVED
REJECTED
ISSUED
PARTIALLY_RECEIVED
RECEIVED
PARTIALLY_BILLED
BILLED
CLOSED
CANCELLED
```

Goods receipt statuses:

```text
DRAFT
POSTED
VOIDED
```

Vendor bill statuses:

```text
DRAFT
NEEDS_REVIEW
PENDING_APPROVAL
APPROVED
PARTIALLY_PAID
PAID
VOIDED
CREDITED
```

Supplier payment statuses:

```text
DRAFT
RECORDED
VOIDED
```

Purchase line types:

```text
STOCK
SERVICE
NON_STOCK
ASSET_CANDIDATE
OTHER
```

Matching modes:

```text
NONE
TWO_WAY_PO_BILL
THREE_WAY_PO_RECEIPT_BILL
```

Matching statuses:

```text
NOT_REQUIRED
NOT_MATCHED
MATCHED
MATCHED_WITH_VARIANCE
BLOCKED
OVERRIDDEN
```

VAT modes:

```text
NO_VAT
VAT_INCLUDED
VAT_EXCLUDED
EXEMPT
NEEDS_REVIEW
```

Input VAT claim statuses:

```text
CLAIMABLE
NON_CLAIMABLE
NEEDS_REVIEW
```

Payment methods:

```text
CASH
BANK_TRANSFER
CARD
CHEQUE
OTHER
```

Posting statuses:

```text
not_required
pending
posted
posting_error
reversed
```

Tax sync statuses:

```text
not_required
pending
synced
sync_error
reversed
```

## 8. Data Model Draft

Use repo conventions and current Prisma naming when implementation starts. Shape below is the required business contract, not exact ORM syntax.

### SupplierProfile

Extends item 08 `AccountingCounterparty`.

```text
SupplierProfile
- id
- companyId
- counterpartyId unique
- supplierCode nullable
- supplierType
- displayNameSnapshot
- legalNameSnapshot nullable
- taxId nullable
- branchCode nullable
- vatRegistered nullable
- defaultVatMode nullable
- defaultInputVatClaimStatus nullable
- defaultWhtCategoryCode nullable
- defaultPaymentTermsDays nullable
- defaultExpenseCategoryKey nullable
- defaultAccountHint nullable
- defaultCurrency
- contactName nullable
- email nullable
- phone nullable
- addressJson nullable
- status
- onHoldReason nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,supplierCode where supplierCode exists
- unique companyId,counterpartyId
- index companyId,status
- index companyId,taxId
```

### SupplierBankAccount

Supplier bank details are sensitive payee data. They support AP payment records only; item 13 owns company bank account master and reconciliation.

```text
SupplierBankAccount
- id
- companyId
- supplierId
- bankName
- bankCode nullable
- accountName
- accountNumberEncrypted or accountNumberToken
- accountNumberLast4
- branchName nullable
- isDefault
- status: ACTIVE, ARCHIVED
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- index companyId,supplierId,status
```

If encryption or tokenization primitives do not exist, defer full account number storage and store masked/last4 display data plus note. Do not store unmasked bank numbers in audit metadata or outbox payloads.

### PurchaseRequest

```text
PurchaseRequest
- id
- companyId
- branchId nullable
- requestNumber nullable
- status
- requesterUserId
- neededByDate nullable
- supplierId nullable
- supplierSnapshotJson nullable
- reason nullable
- budgetCode nullable
- currency
- subtotalAmount
- discountAmount
- taxableAmount
- vatAmount
- whtEstimateAmount nullable
- grandTotalAmount
- approvalStatus nullable
- submittedAt nullable
- approvedByUserId nullable
- approvedAt nullable
- rejectedByUserId nullable
- rejectedAt nullable
- approvalNote nullable
- convertedPurchaseOrderId nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,requestNumber where requestNumber exists
- index companyId,status
- index companyId,branchId,status
- index companyId,requesterUserId
```

### PurchaseRequestLine

```text
PurchaseRequestLine
- id
- companyId
- purchaseRequestId
- lineNumber
- lineType
- productId nullable
- skuSnapshot nullable
- description
- unitName nullable
- requestedQuantity
- estimatedUnitPrice
- discountAmount
- vatMode
- vatRate nullable
- vatAmount
- lineSubtotalAmount
- lineTotalAmount
- accountHint nullable
- inventoryLocationId nullable
- createdAt
- updatedAt
- unique purchaseRequestId,lineNumber
- index companyId,productId
```

### PurchaseOrder

```text
PurchaseOrder
- id
- companyId
- branchId nullable
- purchaseOrderNumber nullable
- status
- supplierId
- supplierSnapshotJson
- sourcePurchaseRequestId nullable
- orderDate
- expectedDeliveryDate nullable
- paymentTermsDays nullable
- currency
- subtotalAmount
- discountAmount
- taxableAmount
- vatAmount
- whtEstimateAmount nullable
- grandTotalAmount
- receivedAmount
- billedAmount
- outstandingAmount
- matchingMode
- postingStatus
- taxSyncStatus
- submittedAt nullable
- approvedByUserId nullable
- approvedAt nullable
- rejectedByUserId nullable
- rejectedAt nullable
- issuedByUserId nullable
- issuedAt nullable
- cancelledByUserId nullable
- cancelledAt nullable
- cancelReason nullable
- closedByUserId nullable
- closedAt nullable
- closeReason nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,purchaseOrderNumber where purchaseOrderNumber exists
- index companyId,status
- index companyId,branchId,status
- index companyId,supplierId
- index companyId,orderDate
```

Purchase order itself usually does not create ledger posting in MVP. It is commitment evidence and matching source.

### PurchaseOrderLine

```text
PurchaseOrderLine
- id
- companyId
- purchaseOrderId
- sourcePurchaseRequestLineId nullable
- lineNumber
- lineType
- productId nullable
- skuSnapshot nullable
- description
- unitName nullable
- orderedQuantity
- receivedQuantity
- billedQuantity
- unitPrice
- discountAmount
- vatMode
- vatRate nullable
- vatAmount
- whtCategoryCode nullable
- whtRate nullable
- whtEstimateAmount nullable
- lineSubtotalAmount
- lineTotalAmount
- accountHint nullable
- inventoryLocationId nullable
- createdAt
- updatedAt
- unique purchaseOrderId,lineNumber
- index companyId,productId
```

### GoodsReceipt

```text
GoodsReceipt
- id
- companyId
- branchId nullable
- goodsReceiptNumber nullable
- status
- purchaseOrderId
- supplierId
- supplierSnapshotJson
- receivedAt
- receivedByUserId
- note nullable
- inventoryMovementBatchRef nullable
- postingStatus
- voidedByUserId nullable
- voidedAt nullable
- voidReason nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,goodsReceiptNumber where goodsReceiptNumber exists
- index companyId,purchaseOrderId,status
- index companyId,supplierId
- index companyId,receivedAt
```

### GoodsReceiptLine

```text
GoodsReceiptLine
- id
- companyId
- goodsReceiptId
- purchaseOrderLineId
- lineNumber
- lineType
- productId nullable
- description
- inventoryLocationId nullable
- orderedQuantity
- previouslyReceivedQuantity
- receivedQuantity
- acceptedQuantity
- rejectedQuantity
- unitName nullable
- inventoryMovementId nullable
- varianceReason nullable
- createdAt
- updatedAt
- unique goodsReceiptId,lineNumber
- index companyId,productId
- index companyId,inventoryLocationId
```

Only accepted stockable quantity creates inventory movement.

### VendorBill

```text
VendorBill
- id
- companyId
- branchId nullable
- vendorBillNumber nullable
- supplierDocumentNumber nullable
- status
- supplierId
- supplierSnapshotJson
- purchaseOrderId nullable
- goodsReceiptId nullable
- billDate
- receivedDate nullable
- dueDate
- paymentTermsDays nullable
- currency
- vatMode
- subtotalAmount
- discountAmount
- taxableAmount
- vatAmount
- inputVatClaimStatus
- whtCategoryCode nullable
- whtRate nullable
- whtAmount
- grandTotalAmount
- netPayableAmount
- paidAmount
- outstandingAmount
- matchingMode
- matchingStatus
- matchingVarianceAmount
- matchingOverrideReason nullable
- taxInvoiceNumber nullable
- taxInvoiceDate nullable
- pp36Candidate
- attachmentId nullable
- postingStatus
- taxSyncStatus
- journalEntryId nullable
- postingError nullable
- approvedByUserId nullable
- approvedAt nullable
- voidedByUserId nullable
- voidedAt nullable
- voidReason nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,vendorBillNumber where vendorBillNumber exists
- unique companyId,supplierId,supplierDocumentNumber where supplierDocumentNumber exists
- index companyId,status
- index companyId,supplierId
- index companyId,dueDate
- index companyId,postingStatus
- index companyId,taxSyncStatus
```

### VendorBillLine

```text
VendorBillLine
- id
- companyId
- vendorBillId
- purchaseOrderLineId nullable
- goodsReceiptLineId nullable
- lineNumber
- lineType
- productId nullable
- skuSnapshot nullable
- description
- unitName nullable
- quantity
- unitPrice
- discountAmount
- vatMode
- vatRate nullable
- vatAmount
- inputVatClaimStatus
- whtCategoryCode nullable
- whtRate nullable
- whtAmount
- lineSubtotalAmount
- lineTotalAmount
- accountHint nullable
- assetCandidate nullable
- createdAt
- updatedAt
- unique vendorBillId,lineNumber
- index companyId,productId
```

### VendorBillMatch

```text
VendorBillMatch
- id
- companyId
- vendorBillId
- vendorBillLineId nullable
- purchaseOrderId nullable
- purchaseOrderLineId nullable
- goodsReceiptId nullable
- goodsReceiptLineId nullable
- matchStatus
- quantityVariance
- amountVariance
- tolerancePolicyJson nullable
- overrideReason nullable
- overriddenByUserId nullable
- overriddenAt nullable
- createdAt
- updatedAt
- index companyId,vendorBillId
- index companyId,matchStatus
```

### SupplierPayment

Prefer reusing or extending item 08 `AccountingPayment` with `direction = PAID` when it exists. If implementation needs a procurement/AP facade, the business contract is:

```text
SupplierPayment
- id
- companyId
- branchId nullable
- paymentNumber nullable
- status
- supplierId
- supplierSnapshotJson
- paymentDate
- method
- currency
- grossAmount
- whtAmount
- netPaidAmount
- allocatedAmount
- unappliedAmount
- bankAccountRef nullable
- supplierBankAccountId nullable
- externalReference nullable
- note nullable
- postingStatus
- taxSyncStatus
- journalEntryId nullable
- recordedByUserId nullable
- recordedAt nullable
- voidedByUserId nullable
- voidedAt nullable
- voidReason nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,paymentNumber where paymentNumber exists
- index companyId,supplierId,status
- index companyId,paymentDate
- index companyId,postingStatus
```

### SupplierPaymentAllocation

```text
SupplierPaymentAllocation
- id
- companyId
- supplierPaymentId
- vendorBillId
- amount
- whtAmount nullable
- allocatedAt
- createdByUserId
- createdAt
- unique supplierPaymentId,vendorBillId when one allocation row per bill is used
- index companyId,vendorBillId
```

### PurchaseApprovalEvent

Approval can be embedded or normalized. Normalized event history should support at least:

```text
PurchaseApprovalEvent
- id
- companyId
- sourceType: PURCHASE_REQUEST, PURCHASE_ORDER, VENDOR_BILL
- sourceId
- action: SUBMITTED, APPROVED, REJECTED, CANCELLED, OVERRIDDEN
- actorUserId
- note nullable
- thresholdSnapshotJson nullable
- createdAt
- index companyId,sourceType,sourceId
```

## 9. Ledger-Ready Source Posting Inputs

Item 10 must be able to ask item 12 for deterministic source payloads. Source payloads must be derived from persisted records, not UI state.

Source types:

```text
vendor_bill
supplier_payment
vendor_bill_void
supplier_payment_void
vendor_credit_adjustment
```

Minimum payload fields:

```text
ProcurementSourcePostingInput
- companyId
- branchId nullable
- sourceType
- sourceId
- sourceEventType
- idempotencyKey
- documentNumber nullable
- sourceDate
- periodKey
- supplierId
- supplierSnapshot
- currency
- subtotalAmount
- discountAmount
- taxableAmount
- inputVatAmount
- inputVatClaimStatus nullable
- whtAmount nullable
- grossAmount
- netPayableAmount
- paidAmount nullable
- outstandingAmount nullable
- lines[]
- allocations[]
- payment nullable
- taxRefs[]
- reversalOf nullable
- postingStatus
```

Line fields:

```text
sourceLineId
productId nullable
description
lineType
quantity
unitPrice
discountAmount
netAmount
vatAmount
whtAmount nullable
accountHint nullable
assetCandidate nullable
inventoryReceiptRef nullable
```

Posting expectations:

- Approved vendor bill:
  - Dr inventory, expense, asset clearing, or configured purchase account.
  - Dr input VAT when claimable.
  - Cr Accounts Payable.
- Supplier payment:
  - Dr Accounts Payable.
  - Cr Cash/Bank or payment clearing.
  - Cr WHT payable when withholding applies.
- Void/reversal:
  - Item 10 creates reversal entry or correction according to source event and close policy.

Final account ids come from ledger posting rules, not hard-coded item 12 source code.

## 10. Inventory Integration

Goods receipt must integrate with item 05 inventory through permission-checked application ports or API/tool routes.

Required behavior:

- Post goods receipt inside a transaction or compensating workflow that creates receipt records, inventory movements, audit, and outbox consistently.
- For stockable lines, create an incoming stock movement with:
  - company id
  - branch id when available
  - product id
  - location id
  - quantity
  - occurredAt from receipt posting time
  - reference type `goods_receipt`
  - reference id `goodsReceiptId`
  - reference line id `goodsReceiptLineId`
  - actor user id
- If item 05 supports only generic `stock_in`, use `stock_in`.
- If item 05 later adds `purchase_receipt`, use that value only after contracts and movement logic support it.
- Never mutate inventory balance directly from procurement code.
- Goods receipt void must use inventory reversal/adjustment behavior when available. If item 05 has no safe reversal, block void after posting and return actionable `inventory_reversal_unavailable`.

## 11. Tax Integration

Item 12 exposes source tax facts for item 11. It must not own filing periods, export packages, or WHT certificate generation.

Tax event source candidates:

- Approved vendor bill with claimable input VAT -> `VAT_INPUT`.
- Approved vendor bill with exempt/non-claimable VAT -> excluded/review issue source.
- Supplier payment with WHT -> `WHT_WITHHELD`.
- Foreign service purchase marked PP36 candidate -> `TAX_REVIEW` or PP36 source per item 11 contract.

Tax source payload fields:

```text
sourceType
sourceId
sourceLineId nullable
eventType
supplierId
supplierSnapshot
taxId nullable
branchCode nullable
taxInvoiceNumber nullable
taxInvoiceDate nullable
paymentDate nullable
taxableAmount
vatAmount
inputVatClaimStatus nullable
whtCategoryCode nullable
whtRate nullable
whtAmount nullable
grossAmount
netPaidAmount nullable
currency
reviewIssues[]
sourceChecksum
```

Rules:

- Tax source generation is idempotent by source checksum.
- Missing supplier tax id, missing branch code, missing tax invoice date, inconsistent VAT amount, unknown WHT category, or missing payment date creates review issue instead of inventing values.
- Filed/closed tax periods from item 11 must block silent source tax event mutation.
- Accounting period close from item 10 must also be respected.

## 12. API Behavior

Use current route conventions from earlier items. If no convention exists, default to `/v1/companies/:companyId/procurement` for purchase workflows and `/v1/companies/:companyId/accounts-payable` for AP workflows. Route `companyId` is a tenant selection hint and must be verified against request context.

### Supplier Routes

```text
GET /procurement/suppliers
- Permission: procurement.supplier.read
- Lists suppliers with search, status, tax id, type, and pagination filters.

POST /procurement/suppliers
- Permission: procurement.supplier.manage
- Creates or links vendor counterparty and supplier profile.

GET /procurement/suppliers/:supplierId
- Permission: procurement.supplier.read
- Returns supplier profile, safe contacts, defaults, recent purchase/AP summary, and audit refs.

PATCH /procurement/suppliers/:supplierId
- Permission: procurement.supplier.manage
- Updates supplier profile fields. Historical snapshots do not change.

GET /procurement/suppliers/:supplierId/bank-accounts
- Permission: procurement.supplier.bank.read
- Lists masked bank detail rows. Audited when read audit exists.

POST /procurement/suppliers/:supplierId/bank-accounts
- Permission: procurement.supplier.bank.manage
- Adds sensitive payee details using current encryption/tokenization policy or stores masked-only fallback.
```

### Purchase Request Routes

```text
GET /procurement/purchase-requests
- Permission: procurement.purchase_request.read
- Lists requests by status, requester, branch, needed date, supplier, and search.

POST /procurement/purchase-requests
- Permission: procurement.purchase_request.create
- Creates draft request with lines and totals.

GET /procurement/purchase-requests/:requestId
- Permission: procurement.purchase_request.read
- Returns header, lines, approval events, conversion refs, and audit summary.

PATCH /procurement/purchase-requests/:requestId
- Permission: procurement.purchase_request.update
- Updates draft or policy-allowed rejected request only.

POST /procurement/purchase-requests/:requestId/submit
- Permission: procurement.purchase_request.submit
- Submits for approval.

POST /procurement/purchase-requests/:requestId/approve
- Permission: procurement.purchase_request.approve
- Approves request if actor meets threshold/branch policy and self-approval rule.

POST /procurement/purchase-requests/:requestId/reject
- Permission: procurement.purchase_request.approve
- Rejects with note.

POST /procurement/purchase-requests/:requestId/cancel
- Permission: procurement.purchase_request.cancel
- Cancels when not converted or policy allows.

POST /procurement/purchase-requests/:requestId/convert-to-po
- Permission: procurement.purchase_order.create
- Creates draft purchase order from approved request.
```

### Purchase Order Routes

```text
GET /procurement/purchase-orders
- Permission: procurement.purchase_order.read
- Lists POs by status, supplier, branch, date, receiving state, billing state, and search.

POST /procurement/purchase-orders
- Permission: procurement.purchase_order.create
- Creates draft direct PO when policy allows.

GET /procurement/purchase-orders/:purchaseOrderId
- Permission: procurement.purchase_order.read
- Returns header, lines, approvals, receipts, bills, matching summary, and audit summary.

PATCH /procurement/purchase-orders/:purchaseOrderId
- Permission: procurement.purchase_order.update
- Updates draft or policy-allowed rejected PO only.

POST /procurement/purchase-orders/:purchaseOrderId/submit
- Permission: procurement.purchase_order.submit
- Submits for approval.

POST /procurement/purchase-orders/:purchaseOrderId/approve
- Permission: procurement.purchase_order.approve
- Approves PO under threshold policy.

POST /procurement/purchase-orders/:purchaseOrderId/reject
- Permission: procurement.purchase_order.approve
- Rejects with note.

POST /procurement/purchase-orders/:purchaseOrderId/issue
- Permission: procurement.purchase_order.issue
- Assigns official number, locks fields, emits event.

POST /procurement/purchase-orders/:purchaseOrderId/cancel
- Permission: procurement.purchase_order.cancel
- Cancels if no blocking receipt/bill exists.

POST /procurement/purchase-orders/:purchaseOrderId/close
- Permission: procurement.purchase_order.close
- Closes completed or manually resolved PO with reason.
```

### Goods Receipt Routes

```text
GET /procurement/goods-receipts
- Permission: procurement.goods_receipt.read
- Lists receipts by PO, supplier, status, date, product, location, and branch.

POST /procurement/goods-receipts
- Permission: procurement.goods_receipt.create
- Creates draft receipt from issued PO lines.

PATCH /procurement/goods-receipts/:goodsReceiptId
- Permission: procurement.goods_receipt.update
- Updates draft receipt only.

POST /procurement/goods-receipts/:goodsReceiptId/post
- Permission: procurement.goods_receipt.post
- Posts receipt, creates inventory movements, updates PO received quantities, audits, emits event.

POST /procurement/goods-receipts/:goodsReceiptId/void
- Permission: procurement.goods_receipt.void
- Voids only when inventory reversal is safe or no stock movement exists. Requires reason.
```

### Vendor Bill and AP Routes

```text
GET /accounts-payable/vendor-bills
- Permission: accounts_payable.vendor_bill.read
- Lists bills by status, supplier, due date, match status, payment status, tax status, posting status.

POST /accounts-payable/vendor-bills
- Permission: accounts_payable.vendor_bill.create
- Creates draft bill from PO/receipt/direct policy/evidence. Direct vendor bill without PO is allowed for `FINANCE` by default and must be audit-visible.

GET /accounts-payable/vendor-bills/:vendorBillId
- Permission: accounts_payable.vendor_bill.read
- Returns header, lines, match rows, approvals, payments, tax refs, posting status, and audit summary.

PATCH /accounts-payable/vendor-bills/:vendorBillId
- Permission: accounts_payable.vendor_bill.update
- Updates draft or needs-review bill only.

POST /accounts-payable/vendor-bills/:vendorBillId/match
- Permission: accounts_payable.vendor_bill.match
- Recomputes matching against PO/receipt lines.

POST /accounts-payable/vendor-bills/:vendorBillId/override-match
- Permission: accounts_payable.vendor_bill.match_override
- Accepts variance with reason and audit.

POST /accounts-payable/vendor-bills/:vendorBillId/submit
- Permission: accounts_payable.vendor_bill.submit
- Submits for approval.

POST /accounts-payable/vendor-bills/:vendorBillId/approve
- Permission: accounts_payable.vendor_bill.approve
- Approves bill, locks fields, sets posting/tax sync pending.

POST /accounts-payable/vendor-bills/:vendorBillId/reject
- Permission: accounts_payable.vendor_bill.approve
- Rejects with note.

POST /accounts-payable/vendor-bills/:vendorBillId/void
- Permission: accounts_payable.vendor_bill.void
- Requires reason, checks payment/posting/period/tax state, emits reversal-ready event.

GET /accounts-payable/aging
- Permission: accounts_payable.aging.read
- Returns AP aging by as-of date, supplier, branch, bucket config, and currency.

GET /accounts-payable/supplier-statements/:supplierId
- Permission: accounts_payable.statement.read
- Returns bills, credits, payments, allocations, and running balance.
```

### Supplier Payment Routes

```text
GET /accounts-payable/payments
- Permission: accounts_payable.payment.read
- Lists supplier payments by supplier, status, date, method, posting status, tax status.

POST /accounts-payable/payments
- Permission: accounts_payable.payment.create
- Records supplier payment and allocations. Does not initiate external bank transfer.

GET /accounts-payable/payments/:paymentId
- Permission: accounts_payable.payment.read
- Returns payment, allocations, WHT facts, posting status, and audit summary.

POST /accounts-payable/payments/:paymentId/void
- Permission: accounts_payable.payment.void
- Requires reason, checks period/tax/posting state, emits reversal-ready event.
```

## 13. API Response and Error Behavior

- Missing authentication returns `401`.
- Missing permission returns `403`.
- Cross-company access returns `404` or `403` according to existing repo policy; do not leak record existence.
- Updating locked issued/posted/approved records returns stable validation error such as `record_locked`.
- Approval threshold failure returns `approval_threshold_exceeded`.
- Self-approval rejection returns `self_approval_not_allowed`.
- Receiving over tolerance returns `receipt_quantity_over_tolerance` unless override permission is used.
- Inventory movement failure returns `inventory_receipt_failed` with redacted actionable message.
- Inventory reversal unavailable returns `inventory_reversal_unavailable`.
- Matching variance block returns `vendor_bill_match_blocked`.
- Duplicate supplier document number returns `duplicate_supplier_document_number`.
- Paying unapproved bill returns `vendor_bill_not_approved`.
- Overpaying a bill returns `supplier_overpayment_not_supported` unless policy later enables supplier credits.
- Posting into closed accounting period returns `period_closed`.
- Filed/closed tax period mutation returns `tax_period_closed`.
- Missing WHT/payment date creates review issue, not silent inference.

## 14. Web UI Behavior

Web owns all item 12 mutations.

Navigation:

- Procurement > Suppliers.
- Procurement > Purchase Requests.
- Procurement > Purchase Orders.
- Procurement > Goods Receipts.
- Finance > Accounts Payable.
- Finance > Supplier Payments.
- Reports > AP Aging.

Supplier screens:

- Supplier list with search, status, tax id, type, AP balance, overdue balance, and last activity.
- Supplier detail with profile, contacts, tax/payment defaults, masked bank accounts, purchase documents, AP statement, audit trail.
- Supplier edit modal/page with validation and permission states.

Purchase request screens:

- Request list by status/requester/branch/needed date.
- Request form with product/service line search, quantities, estimated price, reason, budget/category hints, branch, needed date.
- Approval queue with threshold, requester, amount, branch, and approve/reject actions.

Purchase order screens:

- PO list with status, supplier, delivery state, billing state, amount, and approval state.
- PO detail with lines, approvals, receipts, vendor bills, matching summary, and source links.
- PO create/convert flow from approved purchase request.
- Issue/cancel/close actions with confirmation, disabled states, and reason capture.

Goods receipt screens:

- Receive from PO screen optimized for scanner/manual product search, location selection, expected vs received quantity, accepted/rejected quantity, and variance reason.
- Posted receipt detail with immutable movement refs and inventory deep links.
- Void action only when backend says safe.

Accounts payable screens:

- Vendor bill inbox with draft/needs-review/pending approval/approved/paid filters.
- Vendor bill form from PO/receipt/direct bill with tax fields, WHT, attachments, matching panel, and variance override workflow.
- AP aging report with buckets, supplier, branch, as-of date, drill-down to bills/payments, export request when supported.
- Supplier statement with running balance and source links.
- Supplier payment form with selectable approved unpaid bills, allocation amounts, WHT fields, payment method, reference, and no bank-transfer execution promise.

UI rules:

- Every API load, submit, filter, match, approve, issue, post, void, pay, export, or refresh shows visible loader over the relevant scope.
- Disable covered actions while pending.
- Show forbidden, readonly, empty, validation-error, match-blocked, inventory-error, period-closed, and tax-period-closed states.
- Thai and English visible labels are required where current i18n patterns exist.
- Do not add marketing landing pages.

## 15. LINE and AI Behavior

LINE and AI are read-only for item 12.

Allowed read intents through permission-checked tools:

- Open purchase requests awaiting approval.
- Purchase orders not received, partially received, or received-not-billed.
- Supplier bills due soon or overdue.
- AP aging summary by supplier and bucket.
- Supplier balance or statement summary.
- Vendor bill tax review issues.
- Posting/tax sync exception summary.

Required response behavior:

- Cite source refs and dates.
- Say when data is missing, blocked by permission, or not implemented.
- Provide web deep links for approval, receiving, bill review, payment, and reports.
- Refuse mutation requests such as approve PO, post receipt, approve bill, record payment, void bill, change supplier bank account, or file tax.

AI Gateway must not import API Prisma client or procurement repositories directly. It must call permission-checked ERP APIs/tools.

## 16. Permission Keys

Add or map these permissions:

```text
procurement.supplier.read
procurement.supplier.manage
procurement.supplier.bank.read
procurement.supplier.bank.manage
procurement.purchase_request.read
procurement.purchase_request.create
procurement.purchase_request.update
procurement.purchase_request.submit
procurement.purchase_request.approve
procurement.purchase_request.cancel
procurement.purchase_order.read
procurement.purchase_order.create
procurement.purchase_order.update
procurement.purchase_order.submit
procurement.purchase_order.approve
procurement.purchase_order.issue
procurement.purchase_order.cancel
procurement.purchase_order.close
procurement.goods_receipt.read
procurement.goods_receipt.create
procurement.goods_receipt.update
procurement.goods_receipt.post
procurement.goods_receipt.void
accounts_payable.vendor_bill.read
accounts_payable.vendor_bill.create
accounts_payable.vendor_bill.update
accounts_payable.vendor_bill.match
accounts_payable.vendor_bill.match_override
accounts_payable.vendor_bill.submit
accounts_payable.vendor_bill.approve
accounts_payable.vendor_bill.void
accounts_payable.payment.read
accounts_payable.payment.create
accounts_payable.payment.void
accounts_payable.aging.read
accounts_payable.statement.read
accounts_payable.report.export
```

Default grants:

```text
OWNER: all procurement and accounts payable permissions
ADMIN: supplier read/manage, purchase/AP read, report read/export where company policy allows
MANAGER: purchase request read/approve, purchase order read/approve within ABAC/threshold, AP read summary when granted
STAFF: purchase request create/read/update/submit/cancel for own branch or own records
INVENTORY: supplier read, purchase order read, goods receipt read/create/update/post for assigned branches
FINANCE: supplier manage, purchase order create/update/issue, vendor bill manage, payment create/void, AP aging/statement/report
ACCOUNTANT: AP/tax/posting read, vendor bill approve where granted, AP reports/export, posting/tax exception review
AUDITOR_READONLY: read-only supplier, purchase, AP, statement, posting/tax refs, and export when granted
SALES, MARKETING: no procurement/AP mutation permissions by default
```

Server-side ABAC must restrict company, branch, ownership, threshold, and sensitive bank detail access.

## 17. Audit Actions

Always audit successful and denied high-risk actions where audit primitives exist:

```text
procurement.supplier.create
procurement.supplier.update
procurement.supplier.bank.read
procurement.supplier.bank.create
procurement.supplier.bank.update
procurement.purchase_request.submit
procurement.purchase_request.approve
procurement.purchase_request.reject
procurement.purchase_request.cancel
procurement.purchase_order.create
procurement.purchase_order.submit
procurement.purchase_order.approve
procurement.purchase_order.reject
procurement.purchase_order.issue
procurement.purchase_order.cancel
procurement.purchase_order.close
procurement.goods_receipt.post
procurement.goods_receipt.void
accounts_payable.vendor_bill.create
accounts_payable.vendor_bill.match_override
accounts_payable.vendor_bill.approve
accounts_payable.vendor_bill.reject
accounts_payable.vendor_bill.void
accounts_payable.payment.record
accounts_payable.payment.void
accounts_payable.report.export
```

Audit metadata may include ids, document numbers, supplier id, branch id, totals, variance summary, status, reason, and source refs. It must not include unmasked bank account numbers, full attachment bodies, signed URLs, auth tokens, secrets, or unrestricted OCR/raw extraction text.

## 18. Outbox Events

Emit bounded, redacted events where outbox exists:

```text
supplier.created
supplier.updated
purchase_request.submitted
purchase_request.approved
purchase_order.issued
purchase_order.cancelled
goods_receipt.posted
goods_receipt.voided
vendor_bill.created
vendor_bill.approved
vendor_bill.voided
supplier_payment.recorded
supplier_payment.voided
accounts_payable.overdue_detected
procurement.posting_status_changed
procurement.tax_sync_status_changed
```

Outbox payloads should include ids, company id, branch id, supplier id, document number, status, source refs, dates, totals, and small summary fields only.

## 19. Edge Cases

- Supplier exists as customer only: update shared counterparty to `BOTH` or create supplier profile linked to same counterparty according to item 08 model.
- Supplier tax id duplicates another supplier: warn/block according to company policy; never merge automatically.
- Supplier placed on hold: block new PO and payment unless override permission is granted.
- Purchase request approved then supplier price changes: PO captures new supplier snapshot and approval/money state.
- Purchase order partially received then cancelled: block cancellation; allow close with reason for remaining quantity.
- Goods receipt posted to wrong location: require safe inventory reversal or correction receipt.
- Vendor bill references PO but no receipt: two-way match allowed for service/non-stock lines; stock lines use three-way match unless policy overrides.
- Vendor bill amount differs from PO: block or require match override reason.
- Vendor bill supplier document number duplicates existing supplier bill: block.
- Payment date before bill date: allow only with warning/override if policy allows advance payment; MVP default blocks against unapproved bill.
- WHT amount differs from configured category/rate: create tax review issue.
- Input VAT amount present without tax invoice number/date: mark `NEEDS_REVIEW`.
- Accounting period closed: reject approval/payment/void/correction that would alter closed period.
- Tax period filed/closed: reject silent tax source mutation and require adjustment flow.
- Item 05 inventory reversal missing: block posted receipt void.
- Item 10 ledger unavailable: keep posting status pending and expose source input contract.
- Item 11 tax unavailable: keep tax sync status pending/not_required and expose source tax payload.

## 20. Acceptance Criteria

- [ ] Supplier profile extends shared counterparty model and avoids duplicate vendor master.
- [ ] Supplier sensitive bank details are protected by dedicated permission and never leak unmasked values in audit/outbox/API list responses.
- [ ] Purchase request workflow supports draft, submit, approve, reject, cancel, and convert to PO.
- [ ] Purchase order workflow supports draft, approval, issue, partial receipt, billing state, cancel/close policy, and immutable issued snapshots.
- [ ] Goods receipt posting creates inventory movements through inventory module boundary and never edits balance directly.
- [ ] Vendor bill workflow supports draft, matching, variance override, approval, void policy, tax fields, and posting/tax sync status.
- [ ] AP payment workflow records partial payments, allocations, WHT, and outstanding balance without initiating bank transfers.
- [ ] AP aging and supplier statement derive from approved bills, credits, and payment allocations.
- [ ] Ledger source posting inputs are deterministic, idempotent, and exposed through source adapter/use case.
- [ ] Tax source payloads cover input VAT, WHT, PP36 review candidates, and review issues.
- [ ] All item 12 mutations are permission-protected, branch/company-scoped, audited, and outbox-backed where primitives exist.
- [ ] Web shows supplier, PR, PO, goods receipt, vendor bill, payment, AP aging, and statement workflows with visible loaders.
- [ ] LINE/AI read tools are permission-checked and refuse procurement/AP mutations.
- [ ] Implementation does not mark checklist item 12 complete until verification commands pass.

## 21. Test Cases

Unit/domain:

- Supplier normalization and duplicate code/tax id policy.
- Purchase request total calculation and approval threshold.
- Purchase order issue locking and received/billed quantity rollups.
- Goods receipt quantity/tolerance validation.
- Vendor bill two-way and three-way matching.
- Vendor bill tax total and input VAT claim status.
- Supplier payment allocation, partial payment, WHT, and outstanding balance.
- AP aging bucket calculation.
- Source posting input idempotency key and amount mapping.
- Tax source checksum and review issue generation.

Integration/API:

- Tenant and branch isolation on every list/detail/mutation route.
- Permission denial for supplier bank details, approvals, receipt posting, bill approval, and payment record.
- Purchase request approve rejects self-approval by default.
- PO issue creates official sequence number and audit/outbox.
- Goods receipt post creates inventory movement with source refs.
- Goods receipt void blocks when inventory reversal unavailable.
- Vendor bill duplicate supplier document number blocks.
- Vendor bill approval sets posting/tax sync pending.
- Supplier payment rejects unapproved bill and overpayment by default.
- Closed accounting period blocks bill/payment/void mutation when ledger policy exists.
- Filed tax period blocks silent source tax mutation when tax policy exists.

Web/UI:

- Supplier list/detail/form loader and forbidden states.
- PR form submit/approval flow and disabled pending controls.
- PO conversion, issue, detail source links, and cancel/close confirmations.
- Goods receipt receive screen handles stock/service lines and variance reason.
- Vendor bill matching panel shows blocked/override states.
- Payment form supports allocation and WHT review.
- AP aging and supplier statement filters/drill-down.
- Thai/English labels where i18n exists.

AI/LINE:

- AP aging question returns only allowed supplier/bill data with source refs.
- Mutation request such as approve PO or pay supplier is refused with web deep link.
- Cross-company/forbidden supplier question returns safe denial.

## 22. Implementation Handoff Checklist

- [ ] Read this spec.
- [ ] Read [[plans/procurement-supplier-ap-plan|Procurement, Supplier, and Accounts Payable Plan]].
- [ ] Read [[specs/accounting-documents-spec|Accounting Documents Spec]] for counterparty/payment hooks.
- [ ] Read [[specs/inventory-mvp-spec|Inventory MVP Spec]] for stock movement semantics.
- [ ] Read [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] for receipt evidence overlap and non-goals.
- [ ] Read [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]] for source posting adapter contract.
- [ ] Read [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]] for VAT/WHT source events.
- [ ] Read [[specs/permission-matrix|Permission Matrix]] and extend it if implementation policy requires central registration.
- [ ] Read backend/frontend/security guidelines.
- [ ] Inspect latest code before editing because items 01 through 11 may already implement shared primitives.

## 23. Backlog After First Pass

- RFQ and multi-supplier quote comparison.
- Supplier portal and supplier self-service.
- EDI/e-invoice network integration.
- Automatic payment file generation or bank transfer initiation.
- Bank reconciliation and bank statement matching.
- Landed cost allocation.
- Multi-currency revaluation.
- Supplier credit/unapplied overpayment policy.
- Asset capitalization handoff to fixed assets.
- Lot/batch/serial/bin receiving.
- MRP reorder suggestions and purchase planning automation.
- Advanced contract management and SLA scoring.

## 24. Open Questions

- Should supplier payment records reuse item 08 `AccountingPayment` table directly, or expose AP-specific facade backed by the same table?
