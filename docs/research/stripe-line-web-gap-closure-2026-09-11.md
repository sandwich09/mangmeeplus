# LINE/web billing — bug, gap, impact and closure evidence

Status: existing-runtime bug fixes and owned design COMPLETE locally 2026-09-11; full Stripe/native integration remains OPEN. This register extends [UI spec](../specs/mangmee-line-web-billing-ui-spec-th.md) and [UI plan](../plans/mangmee-line-web-billing-ui-plan-th.md). Tests below must be recorded with results; inspection is not E2E PASS.

## Runtime findings and repair status

| ID | Finding / impact | Repair and evidence required | Status |
|---|---|---|---|
| GW01 | Company layout sends signed-out sessions to dashboard, dropping selected recovery path/query | Preserve safe companyGateReturnPath for the login/refresh/legal round trip; browser assertion | FIXED / local verified |
| GW02 | LIFF awaits network then auto-opens a window; fallback anchor may consume a single-use token inside LINE instead of the destination browser, and stale link remains on failure | Prepare then explicit user gesture; external-browser navigation fallback; hide stale links and truthful status; actual LIFF script/browser tests | FIXED / local verified |
| GW03 | Existing inactive LINE user is classified needsSignup | Distinguish blocked identity from missing identity; no invitation to create another trial to bypass account status | FIXED / local verified |
| GW04 | LIFF start + handoff exchange cannot recover term-disabled company | Allow current active member to reach existing /renew only when term expiry caused disable; preserve holds/roles and business denial; identity proof and exchange recheck | FIXED / local verified |
| GW05 | LINE package-change selects first ACTIVE owned company before expired company | Resolve explicit/current company, otherwise ask for selection; never open request against a different company silently | FIXED / local verified |
| GW06 | Marketing lead fallback mailto claims sent; malformed success payload may also pass | Only provider success=true may set sent; preserve form and error on failure; browser intercept prevents real submission | FIXED / local verified |
| GW07 | Complete Stripe adapter/billing state/UI/quote/history/Portal integration not yet implemented | Complete developer design/data and contracts, separate policy-dependent implementation/test gaps; no fabricated PASS from manual renew | OPEN IMPLEMENTATION GAP |
| GW08 | Native LINE app / real Stripe Checkout, 3DS and recurring provider evidence absent | Local simulations cannot certify native apps/provider; retain NOT RUN until actual evidence | NOT RUN |

## Repair scope before Stripe sales opens

- Existing /renew is the usable recovery destination now. Extend start for a sole expired shop or explicitly selected expired shop instead of sending the owner to signup. If active and expired companies coexist without explicit context, show the choice including recoverable companies; never silently choose another ACTIVE shop. A normal business target on an expired handoff must be refused or redirected to /renew, never open protected business routes.
- Current membership and live LINE identity remain mandatory at exchange. Admin-disabled (no term marker), SUSPENDED/ARCHIVED and revoked accounts remain denied. Payment itself never grants OWNER.
- No new charge/Checkout endpoint will be exposed by a recovery repair. Future billing purpose routes retain the stricter OWNER/action allowlist from the UI spec.
- Preserve default trial/request workflows except truthful failure state and wrong-company prevention. Business policy selection is not inferred from a request to audit.

## Evidence

[Evidence and reproducible commands](../evidence/stripe-line-web-gap-2026-09-11/README.md): original 5 failing LINE regressions repaired; expanded focused, real web/API/DB recovery and actual marketing bundle checked. Provider boundaries are explicit.

## Coverage disposition — every LB row accounted for

Full billing LB/T cases are **NOT RUN** until their actual endpoints/provider flow exist. The local evidence below covers only the named existing boundaries; “partial” is not a full payment PASS.

| LB | Evidence available from this audit | Remaining proof |
|---|---|---|
| 01 | LIFF script prepare/open, active session/handoff unit suites | billing purpose → actual quote/Checkout |
| 02 | real browser/API/PG: LINE-only expired owner reaches /renew, simulated admin renew then business allowed | verified Stripe invoice → automatic apply |
| 03 | explicit expired company selection unit; multi-company browser recovery + unchanged other company assertion | company-bound invoice/Checkout/Portal |
| 04 | revoked membership/unlinked/admin hold exchange rejection; employee/cross-company recovery/business denial | billing attempts/history/documents OWNER and tenant guards |
| 05 | inactive/revoked LINE identity denial; signature/raw-body/controller tests | generic billing links and group forwarding must be tested after purpose=billing implementation; legacy business group semantics are not billing proof |
| 06 | real marketing trial form and acknowledged/request failure states | unified web signup/Postmark identity delivery and paid conversion |
| 07 | existing handoff single-use, current-company webhook routing | collectible-attempt/subscription concurrency across web/LINE |
| 08 | design specifies quote/profile/consent/version conflict | real stale quote/currency/tax/config tests |
| 09 | separate LINE/external browser contexts, cookies only in destination | native iOS/Android/default browser and billing review identity |
| 10 | handoff replay/refusal tests; LIFF stale-link clear, blocked window, retry | actual Checkout expired/resume and device popup behavior |
| 11 | real invalid-session → login → exact company+query; legal acceptance recovery | real paid attempt survives login/legal/password gates |
| 12 | no provider evidence | Stripe sandbox 3DS success/decline/cancel; real invoice state |
| 13 | re-entry after manual renewal works without shared LIFF cookies | webhook applies when customer closes Checkout/browser |
| 14 | LINE durable buffer dedup/redelivery tests; prior S-pre repair evidence remains scoped | Stripe event ordering, invoice dedupe, apply crash and notification outbox |
| 15 | no provider evidence | session/back/cancel/void/old payable invoice/duplicate subscription recovery |
| 16 | current term/hold/notice and simulated renewal browser tests | approved grace/cancel policy + Stripe renewal/Portal |
| 17 | design has document authorization and missing/refund state | Stripe Invoice/PDF/Receipt access and expiry/refund cases |
| 18 | browser notice 401/403/500/offline/delayed A→B; marketing network/error cases | billing polling/429/Retry-After/timeout/provider outage |
| 19 | actual 390px/desktop marketing, 390px LIFF ready and renewal controls/keyboard | U02/U04–U10/U12 production screens and native LINE devices |
| 20 | paid CTA disabled in actual marketing, no false form-delivery success, LINE reply/buffer failure coverage | new-sales/Portal policy gate, live recurring status/support, OA/email delivery outbox |

## Additional rich-menu and webhook findings

| ID | Bug and impact | Fix / verification |
|---|---|---|
| GW09 | Promotion card and poster promised PRO free while runtime provisions FREE_TRIAL_15; LINE/web sales claims disagreed | Corrected card to trial 30 days/15 images and paid unavailable; stopped serving obsolete poster in reply. Committed Ver2 manifest → signed webhook → actual handler → reply tests cover all 5 webhook actions; native camera URI remains separate |
| GW10 | Selected expired/revoked B disappears from active query; sole ACTIVE A was auto-selected for next message, risking wrong-company records | Context is checked before single-company shortcut; invalid selection returns no business context. Company list no longer labels A current when stale B was selected. Resolver and picker→switch→package-request regression plus full existing webhook suite |

## Known implementation boundaries, not silently closed

- [Owned developer design](../specs/mangmee-owned-billing-integration-spec-th.md) now specifies schema/DTO/transaction/lease/reconcile/notification/UI/rich-menu/ops responsibilities. GW07 remains an implementation gap: there is no live-capable billing adapter/quote/Checkout/paid-invoice apply/Portal/document UI yet.
- Postmark is the selected target for application email. The current marketing bundle still submits a lead to Web3Forms; this audit fixes truthful error/acknowledgement and does not call a lead request a provisioned account. Provider migration/unified signup remain in their existing plans.
- Remote LINE OA bindings, native camera, native LINE/browser handoff and Stripe/Postmark real provider runs were not inspected or changed by local tests. No real messages, money movement or deployment occurred.
- Application group handoff semantics predate billing. Billing must use generic entry + fresh identity proof and cannot inherit bearer links to a group; the new billing entry remains closed until that test passes.
