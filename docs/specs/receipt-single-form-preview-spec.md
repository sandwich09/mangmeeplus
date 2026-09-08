# Receipt single form and detailed LINE summary

Status: owner approved the preview and authorized UAT deployment on 2026-09-08. Production remains held.

## Product and acceptance

- One receipt has one visible editing surface. Restore the existing financial review form when source facts are ready for review. Incomplete source facts use the existing partial-save editor exclusively until they can be reviewed. Never render two vendor/date/item forms or two competing save paths together.
- Keep the original attachment and expense identity. Unknown source quantities/prices remain blank; partial saving does not confirm or create a second expense. Preserve valid stored rows, tax, discount and charge identities.
- Put source purpose/category inputs in the existing review form when needed; do not require opening a second draft form. Missing-data hints are ordinary Thai at the relevant field, with a short expandable overview instead of a wall of question codes. Technical question IDs/prompts are not customer labels.
- A reviewer must be able to resolve staged facts through the existing review path. Upload-only users keep the narrowly authorized source editor. Preserve read-only, legacy READY correction, conflict and failure paths.
- Restore the reference LINE card's seven summary facts: document type, total, seller, Thai date, document number, tax and expense category, plus relevant safety warnings. Keep the shared theme and original review/open action. No unsolicited chat questionnaire, internal IDs or accounting keys. Initial capture and recovery use the same summary.
- The new explicit financial-review save action reads “บันทึกแบบร่าง” (Save draft). Render it only on step 1 (`data`), exact expense status `DRAFT`, and with the existing edit authority. Later steps and all other statuses omit this action; navigation still uses the existing save function. The separate incomplete-source editor retains its existing partial-save action, so upload-only and NEEDS_REVIEW users are not stranded.
- Capture the real modified web components in a local browser, on mobile and desktop, and render the actual generated LINE Flex payload as a labeled local preview. Do not send a customer message. Deploy UAT after checks; Production is not authorized.

- Dropdowns in both visible editor variants use the shared `ThemedSelect` for trigger and popup, preserving explicit read-only/busy states, Thai item labels, selected option theme and viewport containment.
- Explicit draft saving shows a shared success toast only after the save succeeds. Validation errors identify what to fix; API failures use the central friendly error mapping and exactly one toast, retain entered values, and never display technical codes. A successful write followed by a failed refresh explicitly says the data was saved and asks the user to reopen the expense. It must not replay the write or silently advance the wizard.

## Boundaries

Reuse existing source-draft and financial-review APIs, optimistic concurrency and authority. No schema migration, dependency, new flag, mail activation or signup changes. Source saving and financial finalization remain distinct persisted states, represented by one visible form at a time.

The existing review PATCH accepts optional `sourceItemRef` on each financial line and `removedSourceItemRefs` for explicit removals. These references stay off-screen. Only a reviewer can resolve/remove source rows; validate ownership, uniqueness, retained-line conflicts and the loaded revision. Bind source rows to the financial rows written in the same transaction. Existing row IDs, discounts and charge rows remain intact. Older clients that omit these fields retain their existing behavior. A reload-required error is translated into an ordinary customer instruction.
