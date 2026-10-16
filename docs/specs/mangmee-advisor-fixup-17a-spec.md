# Fix-up 17A: claims and approvals finish in chat

Owner decision: 2026-10-16. Supersedes the web-only expense/claim final-action rule in advisor §11. Substitute receipt certify/approve/sign/preview remain web-only.

Acceptance:
- J7/C02 manual claim facts survive receipt/no-receipt and category choices. Issued postbacks bind to the private owner, epoch, action and exact collected facts/options; stale controls cannot apply. No-receipt uses claim evidence policy, including a reason when required, never expense.review or substitute evidence.
- Receipt upload attaches to the pending claim. Categories are buttons, suggestion first. Existing draft save and submit confirmation controls complete the journey.
- Claim approve/reject and expense confirm/void prepare existing signed cards. Reject asks one reason question. Final writes require the user's button and existing permission, branch, status and source guards.
- Claim payout offers slip upload, then a signed payment card using the existing payment use-case. Missing payout information that LINE cannot safely provide gets one sentence and a web button.
- Expense confirmation retains an outstanding payment request and explicit date through evidence/category repair; omitted payment date defaults to Bangkok today. Required evidence is never waived.
- Approval settings are distinct from a claim decision. No permission-checked settings tool currently exists: link the authorized user to reimbursement policy settings.
- Replies are short Thai with feminine particles and buttons, without numbered text lists, duplicated pending-work questions or invented success.

Implementation plan: reuse stored draft proposals and their validated provenance for bound choices; retain the metered intake path; update action scope/prompt and capability copy; extend the existing action service for claim payment and pending expense payment; verify live router fixtures at the webhook boundary, registered suites, importing API specs, real-module DI and delivery-plan checks. No flags, dependencies, package.json edits, budget-policy or final-mutation gate changes.
