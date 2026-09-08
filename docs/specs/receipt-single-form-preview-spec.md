# Receipt single form and detailed LINE summary

## Corrective date acceptance — 2026-09-08

- An explicitly supplied valid receipt date through an authorized draft/review/source/voluntary LINE save resolves current unreadable/implausible/assumed date state in the same transaction, even when equal to the old upload-day placeholder. Preserve raw OCR evidence and record actor/date/time of resolution. Remove only date-specific stale reasons; retain tax/amount/classification findings.
- An omitted date, OCR initialization, pause/resume, unrelated answer or empty source patch must not verify a placeholder. Explicitly clearing a staged date makes it unknown again. A stale, forbidden, invalid or cross-tenant save cannot leave resolved metadata behind.
- Existing drafts recover by saving their date through the ordinary form; no migration, GET mutation, automatic historical verification or form redesign. Optional purpose remains blank and accepted money/category/row identities remain intact.
- Ready/confirmation transitions enforce current date verification at the database transaction boundary as well as the UI. Unverified dates produce a readable message naming the date in step1. Reopening a rejected record remains possible.
- Live acceptance repeats the actual Drtb save/reload/Next/final submit journey after UAT deployment; successful local synthetic tests or infrastructure readiness alone do not close acceptance. Production remains held for explicit new approval.

Status: corrective implementation authorized on 2026-09-08 after live Drtb comparison; redeploy UAT, prepare Production configuration/evidence, then wait for explicit Production deployment approval.

## Product and acceptance

- The existing PANDA MALA financial review form is the stable form for owners/reviewers, including receipts whose source date, vendor or item facts are incomplete. Missing facts must never switch the entire form or remove its existing tax/step layout. Upload-only authority remains separately restricted. Never render two vendor/date/item forms or two competing save paths together.
- Keep the original attachment and expense identity. Unknown source quantities/prices remain blank; partial saving does not confirm or create a second expense. Preserve valid stored rows, tax, discount and charge identities.
- Put source purpose/category inputs in the existing review form when needed; do not require opening a second draft form. Remove the added “ข้อมูลที่ยังต้องเติม” overview/list. Use the existing labels and inline warnings only. Technical question IDs/prompts are not customer labels.
- A reviewer must be able to resolve staged facts through the existing review path. Upload-only users keep the narrowly authorized source editor. Preserve read-only, legacy READY correction, conflict and failure paths.
- Restore the reference LINE card's seven summary facts: document type, total, seller, Thai date, document number, tax and expense category, plus relevant safety warnings. Keep the shared theme and original review/open action. No unsolicited chat questionnaire, internal IDs or accounting keys. Initial capture and recovery use the same summary.
- The new explicit financial-review save action reads “บันทึกแบบร่าง” (Save draft). Render it only on step 1 (`data`), exact expense status `DRAFT`, and with the existing edit authority. Later steps and all other statuses omit this action; navigation still uses the existing save function. The separate incomplete-source editor retains its existing partial-save action, so upload-only and NEEDS_REVIEW users are not stranded.
- Capture the real modified web components in a local browser, on mobile and desktop, and render the actual generated LINE Flex payload as a labeled local preview. Do not send a customer message. Deploy UAT after checks; Production is not authorized.

- Dropdowns in both visible editor variants use the shared `ThemedSelect` for trigger and popup, preserving explicit read-only/busy states, Thai item labels, selected option theme and viewport containment.
- Explicit draft saving shows a shared success toast only after the save succeeds. Validation errors identify what to fix; API failures use the central friendly error mapping and exactly one toast, retain entered values, and never display technical codes. A successful write followed by a failed refresh explicitly says the data was saved and asks the user to reopen the expense. It must not replay the write or silently advance the wizard.

## Corrective acceptance: stable PANDA MALA form

- Reproduce Drtb: source receipt date unknown; one AMERICANO item, quantity 1, unit price 55, total 55 and VAT 3.60 with a stored financial category; source row may still require reconciliation. Show the same financial form as PANDA MALA, preserving the stored financial values/category, without exposing the alternative unit-price/total editor or a missing-data checklist.
- Show an unknown source date as blank in the existing date control, never as a confirmed upload date. Saving a draft may preserve missing source facts; progressing/finalizing must retain the existing completion and review gates.
- Partial facts and financial edits must save atomically under the existing permission and revision checks. Missing numbers stay staged; they must not become zero, delete existing financial rows, alter taxes silently, or discard other fields from the visible form. No two-write save sequence.
- Verify both the known PANDA MALA and incomplete Drtb shapes on mobile/desktop; successful save/reload, inline errors, dropdown theme and step/status button scope. Record screenshots of the real modified form.
- Existing LINE seven-field summary remains unchanged. Production is live today and must remain unchanged while configuration parity and deploy evidence are prepared; deployment needs a new explicit owner instruction.

## Boundaries

Reuse existing source-draft and financial-review APIs, optimistic concurrency and authority. No schema migration, dependency, new flag, mail activation or signup changes. Source saving and financial finalization remain distinct persisted states, represented by one visible form at a time.

The existing review PATCH accepts optional `sourceItemRef` on each financial line and `removedSourceItemRefs` for explicit removals. These references stay off-screen. Only a reviewer can resolve/remove source rows; validate ownership, uniqueness, retained-line conflicts and the loaded revision. Bind source rows to the financial rows written in the same transaction. Existing row IDs, discounts and charge rows remain intact. Older clients that omit these fields retain their existing behavior. A reload-required error is translated into an ordinary customer instruction.

### Next-button acceptance (owner follow-up 2026-09-08)

Complete visible mandatory fields must let the reviewer proceed from step 1 to step 2 and then step 3 without hidden source-draft requirements. A real missing or invalid field must be visible and explained in plain language beside that field or the existing action area. Conditional withholding/payee and VAT requirements must use the same predicate as their visible controls. Incomplete draft saving remains distinct from strict Next/final confirmation; removing the redundant overview must not remove the correction path. Verify both an initially empty financial receipt and existing PANDA/Drtb-shaped rows through the real API and browser.

### Optional purpose (owner follow-up 2026-09-08)

“ซื้อไปใช้ทำอะไร” is optional descriptive metadata. Blank purpose must not block Next, draft/review save, READY or final confirmation. Keep accepting and storing an explicitly supplied purpose, and do not delete a purpose already supplied. Existing AI/financial categories keep their existing accounting rule and visible selector.

Apply the same rule in the browser, API source question/completeness projection, persisted continuation refresh and finalization gates. Legacy records that stored D-PURPOSE as unresolved must be normalized under the current rule when read; no manual per-customer database repair should be needed. Technical continuation identifiers remain internal. Verify blank-purpose real API/DB save/readback and final readiness, plus optional supplied-purpose retention. No new feature flag.
