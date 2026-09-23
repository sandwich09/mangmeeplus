# Commercial feature scope — 2026-09-23

## Product rule

All eight paid catalog variants (four tiers × month/year) grant the same starter feature set. Enterprise also grants two independent rights: produce ภ.ง.ด.53 in the system and issue 50 ทวิ in the system. A Sale deal may add either of those two rights to any paid base tier. Prices and branch, user and receipt limits still differ by tier. Trial retains its current rights.

The full `thai_tax` entitlement includes VAT, ภ.ง.ด.3, CIT and tax configuration. Neither narrow commercial right may imply that whole entitlement. The ภ.ง.ด.53 path must check the requested form at the server, expose only that form's data and artifacts, and retain role/tenant checks. System-issued 50 ทวิ retains its existing role, handoff and launch-route checks; external WHT recording remains available without that right.

“ออก ภ.ง.ด.53” means a printable filing form with the official Revenue Department main form and attachment sheets, populated with payer identity, period, each juristic payee, income, rate and withholding totals. The preparer must sign before filing. A summary report or an English review PDF does not meet this requirement. Missing identity, address, classification, source amount or unresolved review issues stop the export. The official paper templates are [main form](https://www.rd.go.th/fileadmin/tax_pdf/withhold/WHT53_041060.pdf) and [attachment](https://www.rd.go.th/fileadmin/tax_pdf/withhold/290360_attach53.pdf). Electronic import is a distinct journey governed by [RD central format v2](https://rd.go.th/63724.html); this scope does not claim that the PDF is accepted as an SWC upload.

The automatic paper path handles an ordinary on-time filing under section 3 ter for the seeded corporate service, rent, professional, advertising and transport income categories. The source event has no statutory-section or surcharge field, so categories with ambiguous legal basis and late periods stop for accountant handling. A configured due date can account for extensions; otherwise paper filing uses the ordinary seventh day of the following month as a conservative cutoff. The form uses the source income base and withholding amount, never the VAT-inclusive payment total. One payer branch per filing packet is required.

The narrow workspace shows unresolved PND53 review issues, lets the configured tax reviewer record a resolution note after fixing source data, and can mark its exported period filed after the signed paper form is submitted. These operations check PND53 ownership at the server and do not grant the generic Tax workspace.

In Sale, starter features, ภ.ง.ด.53 and 50 ทวิ can be selected. Other controls remain visible but disabled. New or edited snapshots with other feature keys are refused by the API. Already approved and paid snapshots stay immutable. A draft created under an older policy must be reset to the current selection before it can be saved again.

The catalog, deal card, quote and confirmation must state only rights the resulting snapshot grants. The customer sees any feature removal from a package change before paying.

## Acceptance

- Every paid month/year offer grants starter; Enterprise grants only starter + ภ.ง.ด.53 + 50 ทวิ.
- A lower-tier Sale deal can add either or both narrow rights. Direct API submission of `thai_tax`, CRM, inventory or another unready key fails.
- A company with only ภ.ง.ด.53 cannot call the full VAT/ภ.ง.ด.3/CIT Tax workspace or APIs. A company with only 50 ทวิ can issue from an eligible handoff but cannot open the full Tax workspace.
- The PND53 PDF is the printable RD main form plus the required attachment pages, with checks preventing an incomplete paper filing packet. It never falls back to the generic summary PDF.
- Existing full Tax entitlements and immutable paid deal snapshots continue to work; corrections and replacement copies of previously issued 50 ทวิ remain available after downgrade.
