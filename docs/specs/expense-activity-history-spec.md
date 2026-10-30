# Expense activity history

Date: 2026-10-30
Status: Implemented and deployed on UAT/Production; concise revision accepted 2026-10-30
Parent: `expense-receipt-upload-spec.md`

## Product and journey

On the expense detail screen, add `ดูประวัติ` under `เพิ่มเติม`. Open a shared modal over the same page, titled `ประวัติรายการจ่าย` with the expense number and creator display name (`สร้างโดย …`) in the modal title area. Resolve the creator from the expense record, independently of history pagination; never infer it from the current viewer or the first/oldest returned event. Desktop uses a centered modal; mobile fits the viewport. Existing cancellation and duplicate-check behavior remains available.

Display latest human activities first: actor and a short Thai action together, Bangkok date/time once per event. The owner's latest 2026-10-30 revision supersedes the compact change table: show only who did what, to which kind of item, and when. The expense number and creator remain in the title. Show `แก้ไขรายการจ่าย` for expense edits; remove field lists, change counts and before/after tables entirely. Show one `อัปโหลดไฟล์` event per actual upload rather than intent/completion/LINE processing rows. Hide upload-start bookkeeping and suppress a LINE receive follow-on only when the same upload's completion is positively established; retain real standalone LINE uploads and distinguish legacy text-note creation from a file upload. Include human payment and substitute-receipt activities; omit automatic system/service work and follow-on events. Apply this projection before pagination/count; keep durable audit records and the existing API contract intact. Mark failed/denied attempts distinctly. Offer `โหลดเพิ่มเติม` and `ปิด`; support Escape, loading, empty, permission-denied and retry states.

## Data and boundaries

- Use existing AuditLog persistence; no schema migration or new dependency.
- GET `/companies/:companyId/expenses/:expenseId/history?page=1` returns 20 events at a time in stable descending timestamp/ID order.
- Reuse expense detail authorization: company, branch, own/related permission, commercial-access restrictions. Document access permits this document's activity, not company-wide audit access.
- Resolve related payment/substitute-receipt target IDs within the same company and expense. Do not follow into other expenses or reimbursement records.
- Shared contract `ExpenseHistoryResult`: `{ data, total, page, pageSize, creatorDisplayName: string | null }`; each event `{ id, action, result, actorType, actorDisplayName, createdAt, changes }`; `changes` is an array of `{ field, before, after }`, values are display strings or null. Actor kinds/result values follow the existing audit enums.
- Creator name comes from the authorized expense’s `createdByUserId` through the existing company-membership name lookup; an absent name remains null.
- Human activity projection permits USER/CRM_CUSTOMER actors; excludes SYSTEM/SERVICE, `journey.*` telemetry, OCR processing, tax finalization, substitute source refresh, and LINE workflow initialization/transitions. Human creation (`expense.create`), direct edits/LINE answers and confirmed AI edits, uploads, payment and document operations remain visible. Automatic reimbursement confirmation/cancellation is identified by the existing positive authority metadata; direct human confirmation is retained. Scope resolution, authority lookup, page rows and count share a repeatable-read transaction.
- Expose only safe fields above. No generic metadata, request IDs, email, service IDs, document payloads or raw OCR.
- Retain allowlisted before/after audit details at the existing expense update boundary, using actual persisted values; the concise UI does not render them. Reuse the same update path for WEB/LINE wherever possible and preserve transactional audit guarantees. Changes must not introduce extra financial mutations or alter existing validation/concurrency semantics.
- History without field snapshots stays an action-only event. Never fabricate old values or guess missing actor identities. Unknown user/creator names use explicit unknown labels; system actions are omitted from this user-facing projection.

## Acceptance criteria

1. A permitted read-only viewer can open history; another tenant, unrelated own-only viewer, or out-of-branch user cannot read it.
2. Creation, updates, confirmation/cancellation, payment and substitute events are visible when recorded as short actor/action/time rows; no changed field names/values or count is rendered, even for historical events with many snapshots.
3. Events are bounded, latest first, and loading further pages works without duplicate UI entries.
4. Opening/closing/retrying history does not save the current expense or discard edits. Error/empty states do not show stale data from another expense.
5. Creator appears in the modal title, each save remains a single short row, and upload bookkeeping/positively matched follow-ons do not consume history pages or counts. Two distinct uploads remain two events.
6. Existing expense review journey and unrelated working-tree changes remain intact.
