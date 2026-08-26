# Agent Memory: P27 Phase 6 Launch Gate

Status: LOCAL_VERIFIED_PENDING_PR
Owner: Finance / Platform
Scope: sales_documents root admission, runoff-safe web UX, critical LED-01..06; no subscribe/billing, UAT or Production deploy
Decisions:
- CLOSE blocks QUOTATION/INVOICE/BILLING_NOTE, standalone RECEIPT/TAX_INVOICE, RecordSimpleIncome, quotation conversion/submit, counterparty POST/PATCH and direct CRM quotation bundles.
- Final root guard and write share one transaction plus advisory shared lock; CLOSE uses the exclusive half. Accounting root flows use launch → source lifecycle; CRM bundle takes its customer graph lock before launch (CLOSE never takes a CRM lock จึงไม่มี lock cycle).
- Existing reads/edits/issues/voids/payments plus qualified source-linked receipt/tax invoice and credit/debit corrections remain open as runoff. Linked receipt requires an issued, fully-paid invoice; receipt and linked tax invoice are each unique among non-voided documents for that source.
- CRM Inbox “สร้างดีล + ใบเสนอราคา” is one atomic/idempotent transaction; accounting permission and launch denial write zero rows. The browser retains one command key across retry.
- Payment void and receipt creation use the same source lifecycle lock. Payment void runs READ COMMITTED deliberately so a waiter sees a newly committed receipt, then refuses until that receipt is voided.
- Payment allocation/create, payment void, source-child create, issue และ document void ใช้ canonical lock order `root invoice → receipt/source → child`; transaction ที่รอ lock ใช้ READ COMMITTED เพื่อคำนวณจาก winner commit. Active tax invoice unique ทั้ง invoice/receipt family และ source void ต้อง void receipt/tax child ก่อน
- Availability endpoint serves create-document, counterparty-manage and quotation-submit permissions; infrastructure failure propagates and every create CTA fails closed.
- Direct income URL and desktop/mobile ledger/hub show plain Thai loading/closed/retry states; no raw gate key is exposed.
Open questions:
- LED-FIN-07 durable VAT `NEEDS_REVIEW` draft remains an owner/schema decision from Phase 3 and is not guessed here.
- Human usability gate (40+ at least three people), UAT and Production remain external release evidence.
Artifacts:
- `apps/api/src/modules/accounting-documents/application/sales-document-launch-gate.ts`
- `apps/api/src/modules/feature-launch/application/launch-gate-lock.ts`
- `apps/api/src/modules/accounting-documents/infrastructure/prisma-accounting.repository.atomic-issue.spec.ts`
- `apps/web/src/features/accounting-documents/sales-root-availability.ts`
- `e2e/income-expense-ledger.spec.ts`
- `docs/evidence/p27-phase6/README.md`
Verification:
- Independent + Fable5 Max findings (TOCTOU, missing mutations, partial CRM deal, fake/duplicate receipt/tax invoice, raw-null correction regression, payment-void snapshot race, lock order/status races) were fixed and covered by regression tests.
- Real PostgreSQL accounting/launch cases 14/14 (no skip), CRM atomic bundle 1/1 และ strict file pair รวม 26/26 pass.
- Playwright `income-expense-ledger.spec.ts --project=chromium`: 6/6; CLOSED executes payment/receipt/tax-invoice/correction mutations. `system-admin.spec.ts` SYS-04 off/on/off: 1/1; desktop reloads and reasserts persisted OFF before evidence capture so the screenshot cannot catch the transient refetch skeleton.
- Browser local CLOSED state at 1280×900 and 390×844: root actions hidden, runoff actions present, no horizontal overflow, console error = 0. Screenshots are in `docs/evidence/p27-phase6/`.
- Final contracts build, API typecheck and web typecheck pass.
- Focused accounting/CRM/gate regression plus spec-suite coverage pass; final critical Playwright rerun: 6/6 pass.
- API DI boot smoke and full API `pretest + test` exit 0; full web suite passes 1,112/1,112.
- Final independent blocker-only review: MERGE-READY, no P0-P2. Fable5 Max findings from prior rounds are included above; the final redundant full-diff CLI pass was stopped after it produced no output for more than nine minutes.
Next:
- Commit/push/open PR to develop, wait for green CI, then merge.
