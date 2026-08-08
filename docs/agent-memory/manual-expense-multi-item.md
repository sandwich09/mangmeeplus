# Agent Memory: manual-expense-multi-item

Status: COMPLETE + VERIFIED (2026-08-08). Owner asks: (1) should the required
`*` be red — yes, made red; (2) how to record several items on one document in
manual entry — previously impossible (form was single-line), now supported.
Owner: Claude
Scope: Web-only. Manual expense form (ExpensesPages.tsx ManualExpensePanel) +
`buildManualExpenseLines` in expenses.model.ts. API untouched — the
`CreateExpenseDraftInput['lines']` contract always accepted multiple lines
(the OCR path writes them); the manual form was the only single-line bottleneck.

Decisions:
- `buildManualExpenseLines` input changed from single
  description/quantity/unitPrice/discountAmount fields to
  `items: ManualExpenseItem[]` (exported type). Lines numbered sequentially;
  service charge appends as `lines.length + 1`. Document-level VAT rate and
  Tax Code stamp every line (one bill = one tax treatment, same as OCR path).
- Form UI: document card = date + receipt attach (description moved out);
  items card = repeatable bordered sub-cards, each with a gray-50 header row
  (รายการที่ N + live per-line net via baht() + trash button when >1 line),
  description full-width, qty/price/discount 3-col grid; dashed "เพิ่มรายการ"
  add button; service charge stays document-level below the items.
- Required markers: red via local `req` element
  (`<span aria-hidden className="text-error-500"> *</span>`) — aria-hidden
  because the inputs carry native `required`. Applied to date, description,
  quantity, unit price. Other pages' plain `*` not touched (out of scope).
- Summary panel: per-item breakdown list (name or รายการที่ N + net, plus
  service charge row) shown only when >1 item or a charge exists, above the
  existing subtotal/VAT/grand-total rows.
- Save guard: `items.every(description.trim() && unitPrice)`; forbidden-chars
  check joins all item descriptions.
- Dictionary: renamed manual_amount_section/helper →
  `expenses.manual_items_section/manual_items_helper`; added `manual_item_n`
  ('รายการที่ {n}'), `manual_add_item`, `manual_remove_item` (th+en);
  manual_document_helper copy updated (date+receipt, no description).

Verification:
- typecheck ✓; unit ✓ 772/772 (updated the service-charge spec to the items
  shape + new multi-item numbering spec in expenses.model.spec.ts); build ✓.
- Summary totals reuse the existing lines-reduce arithmetic — multi-item
  totals flow through calculateManualExpenseTotals unchanged (spec §15 case
  still asserts 1,000 + 100 charge + VAT = 1,177).

Next:
- [ ] Host E2E + commit (with toast v2 / themed-date / themed-file /
      permission-visibility work — all uncommitted)
