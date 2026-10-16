# Fix-up 14: harness follow-up

Scope: U1–U4 only, preserve J1–J5, no flags, dependencies, budget/final-mutation policy changes, package.json edits or release.

U1 caller inventory and acceptance:
- Shared EnsureVendorCounterpartyFromExpense: skip before lookup/write/audit if saved/new sourceDocumentType or OCR classification is TRANSFER_SLIP.
- UpdateExpenseDraft: suppress uploader lookup/autosave for stored type, requested type or saved OCR classification TRANSFER_SLIP; pass effective type/classification to shared guard. Covers subsequent merged-capture saves, web review and source/LINE draft saves.
- LineDraftUpdate post-commit autosave: suppress on target document type or saved OCR classification; pass both to shared guard. Preview still never writes the registry.
- ReceiptOcrApply: guard saved type, supplied source type, supplied OCR classification and saved classification; pass classification/type to shared guard too. ExpenseExtraction passes incoming OCR type independently of reviewer type; ExpenseCaptureReadRunner passes mapped type/classification; ExpenseCaptureAutoSplit passes each document classification; ProcessLineWebhook immediate OCR and deferred pending-media apply pass their OCR classification. These are all five ReceiptOcrApply callers. Preserve reviewer type.
- CreateExpenseDraft creates only an expense, with no vendor registry write. Repository createExpense and ExpenseCaptureHandoff likewise have no registry write. Explicit counterparty, CRM and supplier creation are separate user commands and remain guarded as before.
- Test slips with vendor TEST FOODS CO and valid tax identity; no counterparty lookup/create/update/link or registry audit. Receipt autosave remains working.

U2 exact questions: “50 ทวิ คืออะไร”, “ภงด.53 คืออะไร”, “ใบสำคัญจ่ายคืออะไร”. A definition uses the existing general-knowledge composer for 1–2 sentences explaining meaning/purpose. Relevant help cards are currently DRAFT/access-restricted, so do not promote or bypass them. When the feature is unavailable append the Business 1,999-baht note and existing package-page button for company.plan.manage. No shop record tool calls, data, menu inventions or entitlement bypass. Shop-data/issuance requests remain blocked. No model-free route or budget contract change.

U3 replace both shared substitute reply templates' old LINE boundary with exactly “ลงนามและอนุมัติทำในเว็บค่ะ เตรียมใบรับรองเสร็จแล้วน้องจะส่งลิงก์ให้”. Signing/certifying/approval/preview stay web-only.

U4 parsed acceptedValues.payeeName takes precedence over expense vendor in preparation summaries and all shared continuation/selection/resume labels. Once prepared, evidence.payeeName is authoritative. Facts, preparation card and web handoff must agree on “คุณเอ อินฟลู” when expense vendor is “อินฟลู”.

Plan: add regressions to existing registered specs, make smallest shared fixes, build contracts, typecheck API/gateway, run complete contracts/gateway/API declared suites plus API transitive importer specs, real-module DI and table-driven delivery plan. Prove any remaining failure on exact starting commit 614286776c7d15b509d5e3ba8becf0454fd85f6b. Record results in task memory and /private/tmp/fixup-14-last-message.md.
