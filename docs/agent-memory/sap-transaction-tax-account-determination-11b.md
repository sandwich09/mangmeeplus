# Agent Memory: SAP-Compatible Transaction Tax and Account Determination 11B

Status: Implemented and locally verified across contracts, schema, API, web, ledger, tax, AP, expenses, accounting documents, and AI read tools. Master item 11B remains open until the productive-company configuration review and the final full-period acceptance fixture are completed.

Owner: Codex internal agents for implementation/review; company accountant owns productive activation and SAP/account/report mapping approval.

Scope: Company/effective-dated SAP ERP, SAP S/4HANA, WatchDog, or custom transaction-tax profiles; line-level domestic purchase/sale, import goods, imported services/ภ.พ.36, exports, returns/corrections, input claimability, customs/excise components, G/L account determination, Thai report-box mapping, manual web entry, source-to-tax-to-ledger reconciliation, and permission-checked AI awareness.

Decisions:

- SAP Tax Code is a company/profile/effective-date alias, not a global statutory code or chart-of-accounts key. Legacy ERP `O1=10%` and current S/4 `O1=7%` therefore coexist safely in different profiles.
- Built-in `SAP_ERP_TH_LEGACY` and `SAP_S4_TH_CURRENT` templates are copied on demand as `DRAFT`/`REVIEW_REQUIRED`; they never auto-activate or guess G/L/report mappings.
- Tax Code is line-level. Issued/finalized sources retain profile/code/treatment/evidence/account/report version snapshots; header `NONE`/single/`MIXED` is display only.
- Each profile owns `roundingMode`, `roundingScale`, and `taxAmountTolerance`; those values are snapshotted through source lines, Tax Events, and Journal Lines. PP30/AI aggregation and PP36 cumulative partial-payment deltas use the same immutable policy, with the final payment absorbing the rounded remainder.
- Plain receipt, substitute receipt, supporting-only document, and payment remain no-code/no-input-VAT paths. Domestic claimable input VAT requires a tax invoice, active attachment, supplier VAT identity, invoice number/date, and a verified evidence review.
- Expense upload and manual entry share the same Tax Code selector and server guards. Changing a document to a receipt clears/rejects stale tax facts rather than retaining VAT invisibly.
- Expense upload/manual confirmation resolves FINAL tax inside the same serializable transaction that rechecks the source checksum, verified active evidence attachments, accounting/tax periods, persists line snapshots, CAS-confirms the header, and appends the outbox event.
- Imported goods accept authoritative customs value, duty, excise/other assessed tax, and import VAT only from exact-line verified evidence; customs/excise stay separate components and `CUSTOMS_SUPPORT`, not VAT Tax Codes or PP30.
- Imported-service ภ.พ.36 is recognized on each actual full/partial supplier payment. Recognition is cumulative per allocation/line, the final payment absorbs rounding remainder, exact verified `PAYMENT_EVIDENCE` is consumed once, and output VAT and pending input VAT remain separate.
- Each ภ.พ.36 payment keeps the foreign source tranche separate from its profile-rounded functional-currency tax base/tax. Historical profile, rounding, currency, and FX snapshots remain authoritative for later recognition or claim even after the profile retires; only the final payment absorbs any base/tax remainder.
- `PP36_RECEIPT` is not required to recognize the payment-date liability. A later verified receipt releases input VAT through an immutable PP30-only claim event and pending-to-claimable journal source.
- Supplier-payment recognition and receipt claim use serializable transactions with authoritative bill/allocation/payment state checks. Claim copies the original recognition FX snapshot, races safely with payment void, and reconciliation derives the payment-side source fact from the active supplier-payment allocation rather than inventing a tax-only source.
- Controlled supplier-payment void creates compensating AP/PP36 journals and reverses events/snapshots/bill balances atomically. Filed/locked periods, released input claims, draft journals, missing permission, and unbackfilled legacy recognition fail closed.
- Credit/debit notes preserve the issued original line mapping and sign; cumulative credit cannot exceed original plus issued debit adjustments. Filed history is never rewritten.
- Accounting tax documents recompute final source/config checksums inside the same serializable transaction that CAS-locks source/lines, checks accounting and PP30 period state, persists final line snapshots, and issues the document; a failed issue leaves no partial final snapshot.
- Account roles map to the existing company chart of accounts through explicit effective-dated rules. Missing or ambiguous accounts/report rules block activation, posting, filing, or close; no suspense or guessed account is used.
- Reconciliation compares Source → active Tax Event → configured tax G/L → PP30/PP36/Customs report contribution and feeds filing/period-close blockers.
- PP36 reconciliation reads the immutable active supplier-payment allocation recognition as its source fact, using payment id plus recognition key; it does not reuse the vendor-bill draft line or double-convert a functional-currency base.
- AI Gateway receives only permission-checked, company/branch-scoped, redacted read tools for profile, summary, and reconciliation. Empty, missing-reconciliation, or evidence-pending periods stay review-required; AI cannot configure, select, post, claim, resolve, file, or close.

Open questions:

- Productive activation still requires the real company SAP export/configuration, accountant-approved evidence policies, actual chart-account mappings, PP30/PP36 box mappings, rounding policy, and effective dates. Templates are references only.
- `PARTIALLY_DEDUCTIBLE` is represented but intentionally cannot activate until the company supplies an explicit deductible percentage and non-deductible destination/split policy. The resolver returns `partial_deductibility_split_policy_required` instead of guessing.
- Run one accountant-owned full-period acceptance fixture containing domestic sale/purchase, import goods, partial-payment PP36 plus receipt claim, export, credit/debit correction, customs/excise, and plain receipt before checking master item 11B.
- A pre-release database should not contain item-11B PP36 recognition because all three migrations ship together. If such externally-created legacy rows exist, controlled reversal remains fail-closed until an explicit backfill is reviewed.

Artifacts:

- `docs/specs/sap-compatible-transaction-tax-account-determination-spec.md`
- `docs/plans/sap-compatible-transaction-tax-account-determination-plan.md`
- `packages/contracts/src/transaction-tax.ts`
- `apps/api/prisma/migrations/20260714120000_item11b_transaction_tax_schema/`
- `apps/api/prisma/migrations/20260714150000_pp36_partial_payment_recognition/`
- `apps/api/prisma/migrations/20260714170000_vendor_bill_tax_evidence_gate/`
- `apps/api/prisma/migrations/20260714200000_tax_profile_rounding_policy/`
- `apps/api/src/modules/tax/`, `apps/api/src/modules/ledger/`, `apps/api/src/modules/procurement/`, `apps/api/src/modules/expenses/`, and `apps/api/src/modules/accounting-documents/`
- `apps/web/src/features/tax/`, `apps/web/src/features/accounts-payable/`, `apps/web/src/features/expenses/`, and `apps/web/src/features/accounting-documents/`
- AI read integration under `apps/api/src/modules/line-ai/` and `apps/ai-gateway/src/modules/line-ai/`.

Verification:

- Contracts build, Prisma validate/generate, API/Web/AI typechecks, API build, AI build, and Web webpack production build passed.
- Expanded `pnpm test:item11b-tax`: 239/239 passed; API tax AI adapters: 16/16 passed.
- Full API regression: 1,990/1,990 passed; full Web: 286/286 passed; full AI Gateway: 357/357 passed.
- Existing item-11B upgrade database applied the final PP36/evidence/rounding migrations. Fresh database `watchdog_item11b_fresh_20260715` applied all 64 migrations, seeded successfully, and reported schema up to date.
- Authenticated in-app browser smoke on the primary Next/Turbopack runtime passed: seeded-owner login, S/4 template bootstrap as inactive review-required data, Tax Code settings, Tax Account Determination, AP partial-payment controls, evidence workspace, PP30/PP36/Customs reconciliation, linked tax-invoice wizard, and manual expense Tax Code path.
- The webpack fallback build compiled, but `next start` rendered an existing SVG-loader mismatch because this repo configures SVG under `turbopack.rules`; browser acceptance therefore used the repo's primary Next/Turbopack runtime. No new console error appeared during those tax journeys.
- Accounting final-mutation focused tests passed 4/4 (stale concurrent retry, snapshot/status atomicity rollback, filed-PP30 rejection, and correction inheritance); API typecheck passed after Prisma regeneration.
- Final ภ.พ.36 P1 regression set passed 51/51 across amount resolution, historical profile settlement, cumulative partial-payment rounding, concurrent source integrity, claim/void transaction boundaries, FX snapshot propagation, and reconciliation source facts.
- Final expense atomic confirmation tests passed 3/3; focused PP30/AI/evidence re-audit tests passed 43/43 plus repository/AI follow-up 14/14 and Web evidence API 3/3.
- Independent Codex-agent reviews found no P0. Every reported P1 was fixed and re-audited: vendor evidence bridging, atomic final mutations, rounding/tolerance snapshots, PP36 FX/remainder/concurrency/claim/reconciliation, expense confirmation, PP30/AI aggregation, AI empty-period fail-closed behavior, and evidence-file inspection/ACTIVE recheck.
- Contracts/API/Web/AI typechecks and production builds passed after the shared integration changes. `git diff --check` passed after the final documentation sync.

Next:

1. Have the company accountant import/review the productive SAP codes and configure real accounts/report boxes/evidence/rounding policy; do not activate the sample template directly.
2. Execute and sign off the full-period acceptance fixture, including explicit partial-deductibility policy if the company uses it.
3. Check master item 11B only after those evidence lines are recorded; commit only when the owner asks.
