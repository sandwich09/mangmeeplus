# Local active-feature regression fixes — 2026-08-27

## Authority and scope

Owner approved fixing the 2026-08-27 screen audit and commit/push/PR to develop. Users are Thai-speaking business owners aged 40+ and their staff. Keep existing feature switches unchanged; no added dashboard hero, no new product modules, no subscription work. This document is the scoped spec and implementation plan for these bug fixes.

## Product/contract decisions

- A transaction requires its actual source branch. Use an explicit active in-scope company branch, or automatically use the only available branch. A combined read selection is never a write branch. Follow-up writes inherit the persisted source. Preserve permission/audit/atomic-mutation boundaries across all existing callers.
- R01 legacy data is not silently deleted, hidden or guessed into a branch. The 157 rows need provenance evidence from the owner; prevent new invalid writes while retaining access to inspect existing rows. Report this remaining data issue honestly.
- R02 evidence list and export use the same explicit branch selection and server-side scope checks. No cross-company or out-of-scope broadening. Existing filters/permissions still apply. Export confirmation states its actual branch/date scope; stale fetches must not replace a newer branch selection.
- R03 do not bypass launch admission or expose internal route/build policy in the customer UI. Restore the local serving build's ordinary authorization through the existing local procedure only, preserving feature switches and data. Form errors remain readable near the action and are announced/focused without erasing input.
- R04 the existing VAT KPI represents VAT observed on received documents, not legal/tax entitlement. Rename it accordingly and explicitly state that it is not a claimable/finalized amount. Do not invent new eligibility rules or change accounting/tax postings.
- R05 the list's captured-document totals and unconfirmed amounts must be distinguishable from confirmed unpaid balances. Keep Bangkok civil-date semantics explicit; a label must state whether it uses received date, document date, selected period or all-time current state.
- R06 dashboard links carry the intended status/date basis/period to existing expense-list filters. Pending/current unpaid links do not acquire an unrelated month restriction. Filter labels at destination match the clicked metric.
- R07 expose only an existing implemented sales/income entry point for sales_documents ON and the appropriate permissions. No placeholder/prototype navigation or new feature enablement.
- R08 mobile expense list prioritizes entry/upload, pending work and the first rows; secondary summaries are collapsible. Desktop retains useful summaries. Do not restore the rejected dashboard hero.
- R09 show identifying branch names, consistent Thai role/action labels, and plain-language basic capture text. Company-level configuration remains clearly company-wide; personal signatures remain personal.
- R10 retained records on disabled modules are explicitly labeled as historical/read-only-for-new-work. Guidance follows actual feature availability. Notification navigation must not promise an unavailable file; preserve existing reads and permissions.
- R11 confirmed documents are not automatically called ready for the accountant. Warning/correction paths are explicit; do not unlock direct editing of finalized records.
- R12 creating an employee requires an intentional role and branch decision; do not preselect Accountant/Head Office without user choice. Existing all-branch financial-role policy still applies when such a role is deliberately assigned.

## Implementation order

1. Reuse reviewed pending source-branch changes and test fixtures; no unrelated worktree changes.
2. Trace evidence/export and metric/deep-link contracts end to end; add focused regression tests using existing test infrastructure.
3. Apply shared UI/copy fixes, mobile action hierarchy, and employee explicit-choice defaults.
4. Build/typecheck/test on this exact branch. Restore/prove local ordinary capture through its approved local procedure; no remote calls or feature-switch changes.
5. Exercise desktop/mobile branch selection, manual save/readback, upload transport, list/detail/evidence scope, entry points and validation. Use uniquely labeled local test data; preserve old records. Record actual limitations (OCR provider, legacy mapping, downstream flows not exercised).
6. Review diff and changed-file test coverage; commit/push/open PR to develop. No main merge or deployment in this scope.

## Acceptance / evidence

- New transaction roots cannot be branchless; single-branch default and out-of-scope rejection have runnable checks.
- Evidence selected-branch reads and exports use identical scope; denied/revoked branch remains denied.
- Monetary labels accurately describe their source/status/date; no unreviewed tax amount called reclaimable.
- Clicking dashboard pending/unpaid totals reproduces their scope in the expense list.
- Mobile action errors are visible, branch identity readable, and entry/upload reachable from the list.
- Feature ON navigation and disabled-feature historical copy are consistent; no hidden modules enabled.
- Employee role/scope is not silently picked before the operator decides.
- Local real writes/readback and screenshots are reported separately from unit/controlled-fixture checks. No claim of all-flow/real-OCR success without evidence.
- R01 legacy data remains an explicit owner-input dependency until mapping is proven; passing code tests does not close it.
