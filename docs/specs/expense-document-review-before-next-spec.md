# Explicit expense document review before Next

Planning follow-up (2026-09-11): [Expense evidence and substitute routing](expense-evidence-and-substitute-routing-spec.md) defines the proposed next change. It retains explicit Save review and the single inline warning, but adds evidence-based eligibility after review, pending-draft/submit recovery, server confirm checks, and standalone/LINE review semantics. Its new routes are not implemented by the verification results below.

## Problem and journey
An untouched step-2 form currently enables Next while Save review is disabled. OCR or a generic field save does not prove the user checked the document and tax evidence.
For mutable expenses reviewed by an authorized reviewer, select resolved document type/tax evidence, press Save review, then continue. A single warning beside Save review explains the pending action; do not repeat the save reminder in the bottom navigation. Prefilled correct values may be confirmed without editing them.

## Contract and state
The existing review-fields API accepts an explicit `documentReviewAcknowledged: true`. It validates reviewer permission, a current expectedUpdatedAt and resolved known classifications before writing. It persists server-owned review metadata with reviewer/time, document/tax/category selections, primary attachment and extraction identifiers in the same existing transaction. No schema migration.
Clearing the optional document-level category explicitly writes null and keeps item categories unchanged. An unchanged review does not rewrite financial lines merely to record acknowledgement.

A generic field save cannot create this acknowledgement. Acknowledgement is current only while those source identifiers and selections match; OCR, receipt replacement and changed review selections invalidate it. Failed saves keep Next disabled and retain form values. Successful review survives refresh and revisiting earlier steps.

## UX and boundaries
- The save button works for an unchanged valid form. While saving, fields and Next are disabled. A successful unchanged form shows saved status.
- Unresolved document type or tax evidence explains which selection to complete.
- Next checks the same predicate in its handler and disabled state; no implicit save on Next.
- Back/cancel and receipt upload remain accessible. Follow-up on 2026-09-11 supersedes the initial shortcut: all new-substitute entry links on the expense review page remain hidden until the current document review is saved and no review edits/save are pending. This includes the empty viewer and paid check-bill shortcut; standalone creation and existing-certificate viewing/editing keep their existing flows. Opening a SUPERSEDED certificate opens its history, not a new-certificate route.
- The three classification labels have equal minimum height so their dropdowns align, with or without the category AI badge.
- For a paid check bill awaiting review, provide a link that opens and scrolls to the document-review form; it must not navigate into certificate creation.
- Read-only and already-issued locked evidence do not gain an impossible save requirement. Existing final confirmation, accounting, tax, tenant/branch and certificate locks stay authoritative.
- Category requirements remain as currently defined; no new blanket category rule while product clarification is pending.

## Plan and acceptance
1. Add the explicit review intent and shared current-review predicate; persist only through the existing permission/CAS update.
2. Wire the form save and guided Next gate, inline yellow guidance beside Save review and current-review step status.
3. Check first save, prefilled confirmation, failed/conflicting saves, reload, edits, new attachment/extraction, read-only/issued cases, Back and substitute exits.
4. Run focused API/model tests, typechecks and local browser tests on synthetic records only. Record results in task memory.

## Verification
Implemented locally on 2026-09-11. Focused API/model checks and actual local API + Chromium desktop/mobile flow passed; evidence and remaining category clarification are recorded in `docs/agent-memory/expense-document-review-before-next-2026-09-11.md`. No migration, merge or deployment.

Follow-up acceptance passed: classification dropdown alignment including AI badge at desktop widths 1024–1920; mobile 390 px; no new-substitute link before review/after pending edits or failed save, both normal and check-bill paths; existing superseded history remains accessible. See task memory for logs.
