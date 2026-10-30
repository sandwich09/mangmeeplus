# Expense activity history

Date: 2026-10-30
Status: Approved for implementation in chat
Parent: `expense-receipt-upload-spec.md`

## Product and journey

On the expense detail screen, add `ดูประวัติ` under `เพิ่มเติม`. Open a shared modal over the same page, titled `ประวัติรายการจ่าย` with the expense number and creator display name (`สร้างโดย …`) in the modal title area. Resolve the creator from the expense record, independently of history pagination; never infer it from the current viewer or the first/oldest returned event. Desktop uses a centered modal; mobile fits the viewport. Existing cancellation and duplicate-check behavior remains available.

Display latest human activities first: actor and Thai action together, Bangkok date/time once per event, and changed fields when recorded. Per the approved 2026-10-30 revision, each save is one event containing a compact semantic table with columns `ข้อมูล`, `ก่อนแก้ไข`, `หลังแก้ไข`. Only changed fields are rows; column headers appear once, with no arrows or per-value cards/labels. Events without changes remain plain activity rows. Tables fit narrow screens and wrap long values. Include human expense-record, payment and substitute-receipt activities; omit automatic system/service work and automatic follow-on events even when attributed to a user. Apply this projection before pagination/count; keep durable audit records intact. Mark failed/denied attempts distinctly. Offer `โหลดเพิ่มเติม` and `ปิด`; support Escape, loading, empty, permission-denied and retry states.

## Data and boundaries

- Use existing AuditLog persistence; no schema migration or new dependency.
- GET `/companies/:companyId/expenses/:expenseId/history?page=1` returns 20 events at a time in stable descending timestamp/ID order.
- Reuse expense detail authorization: company, branch, own/related permission, commercial-access restrictions. Document access permits this document's activity, not company-wide audit access.
- Resolve related payment/substitute-receipt target IDs within the same company and expense. Do not follow into other expenses or reimbursement records.
- Shared contract `ExpenseHistoryResult`: `{ data, total, page, pageSize, creatorDisplayName: string | null }`; each event `{ id, action, result, actorType, actorDisplayName, createdAt, changes }`; `changes` is an array of `{ field, before, after }`, values are display strings or null. Actor kinds/result values follow the existing audit enums.
- Creator name comes from the authorized expense’s `createdByUserId` through the existing company-membership name lookup; an absent name remains null.
- Human activity projection permits USER/CRM_CUSTOMER actors; excludes SYSTEM/SERVICE, `journey.*` telemetry, OCR processing, tax finalization, substitute source refresh, and LINE workflow initialization/transitions. Human creation (`expense.create`), direct edits/LINE answers and confirmed AI edits, uploads, payment and document operations remain visible. Automatic reimbursement confirmation/cancellation is identified by the existing positive authority metadata; direct human confirmation is retained. Scope resolution, authority lookup, page rows and count share a repeatable-read transaction.
- Expose only safe fields above. No generic metadata, request IDs, email, service IDs, document payloads or raw OCR.
- Add allowlisted before/after details at the existing expense update audit boundary, using actual persisted values. Reuse the same update path for WEB/LINE wherever possible and preserve transactional audit guarantees. Changes must not introduce extra financial mutations or alter existing validation/concurrency semantics.
- History without field snapshots stays an action-only event. Never fabricate old values or guess missing actor identities. Unknown user/creator names use explicit unknown labels; system actions are omitted from this user-facing projection.

## Acceptance criteria

1. A permitted read-only viewer can open history; another tenant, unrelated own-only viewer, or out-of-branch user cannot read it.
2. Creation, updates, confirmation/cancellation, payment and substitute events are visible when recorded; new updates show actual changed fields/values, with no false diff for untouched values.
3. Events are bounded, latest first, and loading further pages works without duplicate UI entries.
4. Opening/closing/retrying history does not save the current expense or discard edits. Error/empty states do not show stale data from another expense.
5. Creator appears in the modal title, multiple changes saved together share one table, and automatic events do not consume history pages or counts.
6. Existing expense review journey and unrelated working-tree changes remain intact.
