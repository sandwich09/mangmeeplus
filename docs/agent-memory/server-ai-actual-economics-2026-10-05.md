# Agent Memory: September AWS and live AI economics

Status: Completed live readback and cost calculations; sale prices remain recommendations.
Owner: thawatchai / Codex
Scope: September 2026 AWS account cost, current Production usage/payment aggregates and public catalog, credit business model. User explicitly corrected the approach: use real data, not document-derived cost estimates.

Decisions:
- Discard earlier document-based assumptions (FX 33, OCR 3.50, benchmark CHAT 0.62–0.75, forecast mix). `outputs/server-ai-economics-20261005/economics.json` was replaced with live-source calculations. Earlier commentary about package margin based on those assumptions is superseded.
- Read cloud operations and support-access runbooks for procedures only. Used non-root `watchdog-bedrock` in account 311414082667. No code, service, IAM, gate, deployment, provider invocation, payment or data mutation.
- AWS Cost Explorer 2026-09-01 inclusive to 2026-10-01 exclusive, UnblendedCost, Estimated=false: USD755.7957298706 total; Claude Sonnet4.6 USD154.85830395; Haiku4.5 USD0.000072; non-model infrastructure USD600.9373539206, including AgentCore USD0.6199909016. Record types Usage USD755.7957298706 and Tax USD0; no Credit/Refund groups returned. This is CE usage, not a downloaded invoice/bank settlement.
- Non-model Environment tags: production USD323.0783276928, UAT USD125.0474460712, shared USD100.0914657378, dev USD4.535883011, untagged USD48.1842314078. Model cost is untagged; do not call account-wide cost Production-only.
- AWS billed token quantities verify Sonnet4.6 USD/M: input3, output15, cache-write3.75, cache-read0.30. Haiku4.5 input1/output5. The local generic Haiku price map differs; no fix was requested or made.
- Production T1 session `INC-20261005-AI-COST` used watchdog_support_ro with transaction_read_only=on and statement_timeout15s. September Bangkok retained ledger:557 provider events,256 distinct request IDs,30 companies,THB523.08. Early475 events/THB441.25 lack CHAT/OCR metadata; do not label a whole-month chat average from them.
- Classified CHAT TEXT September23–30:16 grouped company/request IDs,34 provider events,THB38.31,mean2.394375,p502.54,p903.255,max3.28. This includes intake and subsequent calls recorded under each request, not just one model call; it is a small sample, not an SLA or paid-customer cohort.
- Classified OCR IMAGE September24–30:15 requests,46 calls,THB42.15,mean2.81,p502.91,p903.446,max4.18.14 requests match successful usable extraction audit outcomes, costing40.71 (2.907857/request);1 request at1.44 lacks that matching outcome. Allocating all42.15 over14 verified results gives3.010714 per verified result for a conservative scenario, not a proven recurring cost per sold receipt unit. Only2 requests directly match quota IDs, including attachment matching; do not claim exact commercial-unit reconciliation.
- UTC-aligned Production ledger:551 events,THB517.02,USD15.610844 re-priced from stored tokens at actual AWS billed rates. AWS account model USD154.85837595 is much higher. Attribution of the difference is unresolved; cannot assert it is all UAT/development or missing billing. Surviving DB rows and account billing have different coverage.
- Live AiFxRate33.5663 from open.er-api.com, fetched2026-10-05T14:50:45.583Z, used only to translate display amounts: infrastructureTHB20,171.24,modelsTHB5,198.02,totalTHB25,369.27. This is not the September bank/card settlement FX.
- Live public `/v1/billing/catalog` returned LIVE/NOT_VAT_REGISTERED, monthly249/499/999/1999 with30/50/100/500 receipts; annual2490/4990/9990/19990 with360/600/1200/6000 receipts; all AVAILABLE. Catalog aiMonthlyBudgetSatang200000 is an operational total cap, not an included purchased wallet. Current policy has no offerTerms/addOnOffers. AiCreditGrant/AiCreditEntry are present but empty.
- Actual September live invoice:paid249,refunded249,fee20.43THB. No October invoice in read window. One account has future paidThrough but no unrefunded payment; entitlement is not evidence of retained revenue. Actual profitable paid-customer economics cannot be established from this cohort. Fee20.43 on one refunded transaction is not a universal future fee rate.
- Recommend subscriptions to cover infrastructure plus separate cost-backed CHAT credits and image units. Proposed credit definition1credit=1THB metered provider cost (not1message); proposed50/100/300credits at299/549/1499THB. At observed mean they cover roughly21/42/125 requests; usage can vary. Remaining before fees/infra/staff249/449/1199THB at full redemption. These are price proposals, not observed sales or an approval to publish.
- Proposed separate image packs20/50/100 at349/799/1499THB have extrapolated provider costs60.21/150.54/301.07 at the measured cohort allocation. Do not debit these against CHAT credits too. Existing Enterprise500 images extrapolate to1505.36THB before CHAT/infra/fees; recommend reviewing new-sale quota/price without changing existing purchased rights.

Open questions:
- AWS-account to retained Production usage attribution; durable billable-success denominator; actual paying-user scale; staff/support/LINE OA/other non-AWS cost. No uncertainty is filled with earlier docs. Price/allowance changes require a separate owner decision and implementation scope.

Artifacts:
- [Live AWS and Production evidence](../../outputs/server-ai-economics-20261005/)
- [Source-backed calculations](../../outputs/server-ai-economics-20261005/economics.json)
- [Live database aggregates](../../outputs/server-ai-economics-20261005/live-db-aggregates.json)
- [Live public catalog](../../outputs/server-ai-economics-20261005/live-public-catalog.json)

Verification:
- CE service/environment, record type and30daily totals reconcile to755.7957298706USD. Model-specific Cost/UsageQuantity rates reconcile.
- Python arithmetic checks: infrastructure+models=total;CHAT38.31/16=2.394375;OCR42.15/14=3.010714; all translated values use live33.5663.
- Public health status:ok before readback. Read-only session confirmed at start/end; owned SSM session `watchdog-bedrock-dev-5i854tad4njdsa42nb88xyhgo4` read back Terminated at2026-10-05T22:56:43.334+07:00.
- Local public-web proxy path was unavailable (urllib403,curl404); canonical live `/v1/billing/catalog` returned200. No authentication bypass or alternate credential escalation.
- No application tests: no code change; this task verifies reads and arithmetic.

Next: Discuss the unified-credit proposal below. Do not represent proposed prices or extrapolated costs as observed commercial margins. No implementation or live change is authorized by this business-model discussion.

## Follow-up: one credit wallet for questions and images

User is considering replacing the business model with credit sales, combining CHAT and images, requiring profitability and a clear customer-facing credit cost per question/image. This reopens the earlier separate-wallet recommendation; it does not approve new prices, migrate existing balances or authorize implementation.

- Proposed unit:1 standard question2credits;1 receipt image3credits, including its basic extraction result. Images and questions debit the same balance. Technical retries, acknowledgements and correction of a system failure must not generate extra customer charges. Heavy/multi-document analysis needs a price shown before confirmation; no measured fixed heavy-task cost was invented.
- The new credit is a priced service unit, not the earlier1credit=1THB provider-cost unit. The new conversion must be clear; existing credit rights cannot silently change1:1.
- Proposed packs:299THB/60credits,999/220,1999/450. These cover exclusively30/110/225 standard questions OR20/73/150 images, respectively (220credits leaves1credit after73images). Mixed example:60credits=15questions+10images. Questions cost approximately8.88–9.97THB and images13.33–14.95THB depending on pack.
- Inputs use this conversation's live measurements:CHAT38.31/16=2.394375THB/request;OCR42.15/14=3.010714THB per verified result with unmatched request spend allocated. Sample is small; standard task pricing requires scope and cost controls before launch. The observed CHAT maximum3.28 is a sensitivity case, not a guaranteed upper bound.
- Payment scenario uses current public Stripe Thailand domestic card3.65%+10THB plus0.4% post-payment invoice, multiplied by1.07 as a service-fee reserve: `(price * .0405 + 10) * 1.07`. Public source checked2026-10-05:https://stripe.com/en-th/pricing. These are scenario fees for proposed packs, not fees actually paid on those packs. Current live sale tax status was NOT_VAT_REGISTERED; future VAT treatment can change the result.
- Full redemption as CHAT is the more costly of the two measured mean costs per credit. Proposed packs leave203.51/681.63/1362.94THB after modeled AI/payment costs, about68% contribution BEFORE fixed costs/staff. No70% blended company margin or net-profit guarantee is claimed.
- 999pack detailed calculation:999 revenue−263.38125 AI(110questions)−53.991665 modeled fees=681.627085 contribution. At observed CHAT max3.28 the contribution is584.208335.
- Infrastructure-only baseline20,171.24THB implies30 purchases of the999pack/month at mean sample costs; this excludes the unresolved rest-of-account AI workload and all non-AWS operating expenses.
- More conservative growth scenario retains the ENTIRE previous AWS bill25,369.27THB as continuing background workload and adds NEW paid usage. This is explicitly an incremental workload scenario, not counting the same customer AI twice. Mean-cost break-even38 new999pack purchases/month; sample-max sensitivity44. At40/50/100packs, remaining after modeled AI, payment and that baseline is1895.82/8712.09/42793.44THB; sample-max remaining−2000.93/3841.15/33051.57THB. Staff/support/acquisition/LINE OA and capacity growth remain excluded. Every extra10,000THB/month operating cost needs about15 additional999pack purchases at the mean scenario.
- Pack purchase counts are monthly sales, not registered users or necessarily distinct customers. Prepaid credits carried between months shift redemption cost/cash timing. Credit expiry and ongoing ERP/storage access are undecided; do not imply a one-time top-up funds unlimited permanent service.
- Evidence/calculations:[unified-credit-proposal.json](../../outputs/server-ai-economics-20261005/unified-credit-proposal.json). Python reconciled each pack's price=AI+fee+contribution and checked unit counts/mixed example. No cloud reread was needed: same-session raw AWS/Production evidence reused. No app tests or implementation changes.
