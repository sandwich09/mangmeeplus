# Accounting Product Benchmark

## 1. Goal

Use FlowAccount-style SME workflows as a practical accounting/product baseline while defining where WatchDog-BMS matches, differs, or extends with LINE AI, CRM, workflow automation, and enterprise-grade audit.

This is a feature-gap document, not a UI clone plan. Do not copy FlowAccount UI, wording, or proprietary implementation.

## 2. Official Reference Checked

FlowAccount official site: https://flowaccount.com/

Observed public feature areas:

- Accounting documents: quotation, receipt, billing note/invoice, tax invoice / abbreviated tax invoice.
- Bank reconciliation.
- Stock management.
- Online payment.
- Shopee / Lazada / TikTok Shop connection.
- Developer API.
- MobilePOS: mobile selling, receipt, barcode scanning, sales reports.
- Payroll: salary preparation, withholding tax, social security, employee records, payslip, 50 Tawi email, bank payment files.
- AutoKey: scan bills/receipts and manage expense documents.
- Pro features: user permissions, all sales documents, payables, stock, purchase document, average purchase/sale price movement, multi-unit, deposit/partial payment, partial delivery.
- Pro Business features: multi-warehouse, marketplace connection to issue bills, cut stock, and post accounting automatically.

## 3. Gap Matrix

| Feature area | FlowAccount-style baseline | WatchDog-BMS target | MVP priority |
|---|---|---|---|
| Quotation | Create and manage quotations | Create and manage on web | High |
| Invoice/billing note | Convert documents without retyping | Quote -> invoice/billing -> payment workflow | High |
| Receipt | Issue receipt after payment | Receipt/payment link with audit | High |
| Tax invoice | Full/abbreviated tax invoice | Web-first issue/void/credit/debit note policy | High |
| Expense | Record expenses with receipt | Reimbursement + expense + VAT/WHT review | High |
| WHT | Prepare WHT docs/reports | PND 3/53 reports + 50 Tawi flow | High |
| VAT | VAT report/support | PP30 summary + input/output detail | High |
| Bank reconciliation | Reconcile bank transactions | Later phase unless finance demands early | Medium |
| GL/journal | Accounting detail | Generated double-entry ledger from finalized documents, promoted before Thai Tax MVP | High |
| Stock | Product stock management | Lot/location/movement audit + web scan/action flow | High |
| Purchase document | Purchase and receive stock | PO/receive flow later; stock receive MVP | Medium |
| Multi-warehouse | Pro Business feature | Target architecture supports locations | High for inventory-heavy SME |
| Multi-unit | Product unit management | Include as product data model option | Medium |
| Deposit/partial payment | Sales payment flexibility | Include in document/payment model | Medium |
| Partial delivery | Sales fulfillment flexibility | Later unless operations require early | Low/Medium |
| Marketplace integration | Shopee/Lazada/TikTok connection | Shopee/TikTok/Facebook/Lazada research + imports later | Later |
| Mobile POS | Mobile sale and receipt | Not core first; web workspace + LINE assistant | Low/Medium |
| Barcode scan | Mobile camera scan | Inventory web scan/action flow MVP | High |
| Payroll | Salary, WHT, SSO | Later; not MVP | Later |
| OCR expense | AutoKey bill scanning | Web receipt/bill upload creates draft with OCR/AI extraction and review | High |
| User permissions | Multi-user rights | RBAC/ABAC from foundation | High |
| API | Developer API | Internal typed contracts first, public API later | Low |

## 4. WatchDog-BMS Differentiators

- LINE as AI Business Assistant for summaries and alerts, while web remains the full document/POS-style workspace.
- AI CFO, Sales, Inventory, Tax, CRM, and Marketing agents.
- Workflow automation across alerts, approvals, CRM, tax, and marketing.
- Deeper CRM and follow-up workflow.
- Marketing drafts for Shopee, TikTok, Facebook.
- Enterprise-style audit and permission policy from the start.
- AI Gateway separated from ERP core.
- Owner-first dashboard and proactive suggestions.

## 5. Functional Baseline for Accounting Spec

Required accounting/document capabilities:

- Sales document sequence per company and type.
- Quotation draft.
- Quotation approval if discount threshold exceeded.
- Convert quotation to invoice/billing note/sales order.
- Payment record linked to invoice/customer.
- Receipt creation.
- Tax invoice creation with audit and correction flow.
- Expense with receipt attachment, category, VAT, WHT, payment status.
- Web receipt/bill upload with OCR/AI extraction into editable draft expense/accounting records.
- Payment voucher/payable flow later.
- VAT report lines from source documents.
- WHT report lines from source payments.
- Ledger-ready posting inputs from finalized documents.
- Generated balanced journal entries from finalized documents in item 10.
- General Ledger and Trial Balance from posted journal lines.
- Accounting period lock.
- Export for accountant.

## 6. Design Guidance

- Use FlowAccount as workflow inspiration, not interface clone.
- Keep web screens dense and finance-friendly.
- Keep LINE answers concise and action-linked to web.
- Make document status and audit clear.
- Make draft/issued/voided/locked states explicit.
- Show ledger posting status and accounting consequences from finalized documents.
- Avoid hiding accounting consequences from users.

## 7. Open Questions

- Is bank reconciliation required in MVP?
- Are purchase orders needed before sales documents?
- Does target business use deposits or partial payments often?
- Which marketplace integration matters first when marketplace phase starts: Shopee, TikTok Shop, Facebook, or Lazada?
