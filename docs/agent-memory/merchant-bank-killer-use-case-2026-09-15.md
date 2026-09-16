# Agent Memory: Merchant and bank killer use case

Status: Strategic recommendation prepared 2026-09-15, retained in the 2026-09-16 documentation integration. The owner approved keeping this document; merchant segment, pilot sponsorship and implementation scope still require product decisions.

Owner: thawatchai (Product Owner).

Scope:

- Assess Mangmee Plus capabilities and roadmap for both merchants using SCB Mae Manee / KBank K SHOP and partnerships with those banks.
- Owner clarified that currently exposed product consists of initial features; code presence must not be described as customer availability.
- Owner explicitly chose to pursue merchant adoption and bank partnerships together.

Decisions:

- Recommendation, pending Owner selection: a daily shop-closing journey in LINE combining recorded receipts/payments, expense evidence, outstanding work and accountant handoff. Merchant promise: understand where money went and what needs attention, with little bookkeeping effort.
- Existing foundations verified in code: expense capture, expense daily-closing tool, accountant expense package, income recording UI and income-expense ledger. P27 plan records development/local verification with rollout gates; this session did not verify live cloud state.
- The existing expense daily-closing tool is expense-focused. Its amounts associated with expenses dated today must not be treated as all cash paid today. A combined daily cash summary needs explicit payment-date/source semantics and completeness checks.
- P15–P20 matching and bank/QR/gateway/marketplace/POS connections remain deferred in the master index and connector spec. This recommendation does not change that decision or authorize connector implementation, credentials, outreach or deployment.
- Proposed initial combined pilot can use merchant-confirmed receipt totals plus captured expense/payment evidence. Parsing merchant settlement reports, combining them into a daily narrative and any merchant-summary recording contract are additional scoped work, not verified shipped integrations.
- Call inflow minus outflow a period cash movement based on recorded data. Actual balance requires opening balances and complete movements; profit additionally requires revenue recognition, COGS/stock, accrued expenses and other accounting adjustments. Unknowns must remain visible.
- Bank pitch hypothesis: better merchant engagement and organized business records; later merchant-selected, consented sharing may assist bank review. Do not promise credit approval, lower defaults or automatic access to all merchant data.
- Suggested initial segment: owner-operated single-branch shops already using bank QR, LINE and mixed cash/transfer spending, with no integrated bookkeeping workflow. Validate a narrower segment before expansion.
- Pilot proposal: 20–30 merchants for 4 weeks, measured against their current closing workflow. Candidate targets, not observed results: median closing effort <= 2 minutes, >= 50% time reduction, >= 60% weekly active at week 4, numerical answers traceable to sources and no silent double counting. Include willingness to pay or an explicit bank sponsorship decision.

Open questions:

- Which merchant segment and bank team will sponsor a pilot? No selection inferred.
- What data export/API is actually available under provider terms? Not verified.
- Whether stores value daily closing enough to keep submitting expense evidence and pay; whether banks will sponsor access. Requires pilot evidence.

Artifacts:

- [Master plan index](../plans/mangmee-master-plan-index-th.md)
- [Daily closing spec](../specs/line-ai-owner-daily-closing-spec.md)
- [Income-expense ledger plan](../plans/mangmee-income-expense-ledger-plan-th.md)
- [Connector contract / deferred scope](../specs/mangmee-revenue-connectors-contract-spec-th.md)
- [Accounting OS draft](../specs/mangmee-accounting-operating-system-spec-th.md)
- [Business use case catalogue](../product/business-use-cases.md)
- [Official K SHOP product page](https://www.kasikornbank.com/th/business/sme/digital-banking/kshop/Pages/index.aspx): payment, reports, LINE alerts, Chat & Bill and Pro online sales/stock capabilities. Do not position basic sales summaries or LINE notifications alone as unique.
- [Official Mae Manee product page](https://www.scb.co.th/th/personal-banking/payment/for-merchant/mae-manee-app)

Verification:

- Read local specs, plans, relevant source and public bank product pages. No cloud inspection or customer-data access.
- Code inspected: `erp-expense-daily-closing.use-case.ts`, `RecordIncomePage.tsx`, sales launch gate, expense accountant-package API/UI/use case.
- Research only; no runtime code changes or tests required. Existing unrelated working-tree changes left untouched.

Next:

- Present ranked recommendation with separate merchant and bank value propositions, current/planned boundaries and pilot criteria.
- After Owner selects the proposed use case, prepare the relevant spec/plan and concrete pilot/demo scope. This discussion alone is not implementation approval.
