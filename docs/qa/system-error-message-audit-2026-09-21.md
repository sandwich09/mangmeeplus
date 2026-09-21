# System-wide User-facing Error Copy Audit

Status: REVIEW COMPLETE — default-open remediation complete
Date: 2026-09-21
Owner: Codex
Related:
- `docs/specs/user-facing-error-message-safety-spec.md`
- `docs/plans/user-facing-error-message-safety-plan.md`
- `docs/agent-memory/user-facing-error-message-safety.md`
- `docs/agent-memory/settings-usability-polish-2026-09-21.md`

## 1. Outcome

The system already prevents most raw API diagnostics from reaching customer UI, but its specific,
plain-Thai coverage is uneven outside the original launch modules. The confirmed failure mode is
not mainly raw English or `snake_case` leaking to the screen. It is a useful business reason being
replaced by a safe but wrong-context fallback such as:

`ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง`

Reloading cannot resolve a duplicate tax ID, a closed accounting period, a dual-approval rule, an
invalid sale price, or a provider that has not been configured. This is the same error-UX class as
the reported branch-capacity problem.

No broad copy change should be made by passing API messages through verbatim. The existing fail-
closed boundary is protecting technical and sensitive diagnostics and should remain.

## 2. Evidence and Scale

Static source inspection found:

- 3,123 explicit NestJS exception throw sites in non-test API source.
- 653 unique code-like error identifiers under the same source-derived definition used by the
  current web coverage test.
- 330 of those identifiers have a reviewed mapping in the shared translator; 323 do not.
- 1,320 throw sites with 400, 409, 410, 422, or 503 semantics can potentially fall back to generic
  copy because no shared exact/code/pattern mapping was found.

The 1,320 figure is an audit upper bound, not 1,320 confirmed customer bugs. It includes dynamic
exceptions, operator-only paths, currently unreachable paths, and errors that a domain-specific
renderer may translate locally. Runtime reachability and local translators must be checked before
changing each group.

Focused safety checks passed 13/13:

- caught API `.message` values are not rendered directly;
- persisted workflow/provider diagnostics use reviewed rendering;
- diagnostics returned inside successful responses use reviewed rendering;
- the six original launch modules retain source-derived Thai code coverage;
- status fallbacks and upload failures remain safe.

## 3. Confirmed Wrong-context Examples

The “Current customer copy” column records the behavior at audit time, before the default-open
remediation described in section 8.

These cases were executed directly through the current shared customer-message renderer.

| Real condition | Current customer copy | Why it is misleading | Recommended direction |
|---|---|---|---|
| CRM customer tax ID already exists (`duplicate_tax_id`) | Data from the screen is unsupported; reload | Reload cannot remove the duplicate | Name the duplicate and offer opening the existing customer or correcting the number |
| Invalid inventory sale price (`sale_price_invalid`) | Data from the screen is unsupported; reload | The editable field is known | Name the price rule and keep the user on the field |
| Accounting period is closed (`period_closed`) | Data from the screen is unsupported; reload | This is a business state, not a screen/API mismatch | State that the period is closed and who can reopen it |
| Vendor bill needs two approvers (`vendor_bill_dual_approval_pending`) | Data changed while working; reopen and retry | No concurrent edit occurred | State the two-approver rule and that the submitter cannot be an approver |
| Tax transaction needs review (`transaction_tax_needs_review`) | Data from the screen is unsupported; reload | The required action is review | Link the user to the tax review step |
| Notification cannot be retried until reviewed (`NOTIFICATION_RETRY_REVIEW_REQUIRED`) | Data from the screen is unsupported; reload | The API already knows the correct recovery action | Map the stable code to the reviewed Thai reason |
| Billing provider is not configured (`BILLING_NOT_CONFIGURED`) | System is under maintenance or busy; wait and retry | Waiting will not configure the provider | Tell the user the payment service is not ready and whom to contact |
| Payment is already voided | Data from the screen is unsupported; reload | The operation is already complete | State that the payment is already voided and direct the user to its history |

## 4. Shared-catalogue Coverage by API Module

This table measures the shared translator only. Domain translators can add coverage at a specific
screen; for example, statement extraction has a banking-specific mapper. Counts can overlap across
modules, so the global unique total remains 653 rather than the sum of all rows.

| Module | Code-like identifiers | Shared mappings | Missing | Shared coverage |
|---|---:|---:|---:|---:|
| expenses | 99 | 99 | 0 | 100% |
| crm | 90 | 1 | 89 | 1% |
| procurement | 74 | 4 | 70 | 5% |
| reimbursements | 74 | 74 | 0 | 100% |
| external-signup | 66 | 30 | 36 | 45% |
| auth | 42 | 42 | 0 | 100% |
| system-partner-management | 36 | 36 | 0 | 100% |
| ledger | 29 | 10 | 19 | 34% |
| crm-inbox | 23 | 0 | 23 | 0% |
| tax | 22 | 0 | 22 | 0% |
| reports | 18 | 9 | 9 | 50% |
| employee-access | 15 | 15 | 0 | 100% |
| feature-launch | 15 | 0 | 15 | 0% |
| banking | 14 | 1 | 13 | 7% |
| data-model-core | 13 | 12 | 1 | 92% |
| accounting-documents | 11 | 7 | 4 | 64% |
| data-rights | 10 | 0 | 10 | 0% |
| ai-draft | 8 | 2 | 6 | 25% |
| billing | 7 | 5 | 2 | 71% |
| system-onboarding | 4 | 1 | 3 | 25% |
| inventory | 3 | 0 | 3 | 0% |
| line-ai | 3 | 0 | 3 | 0% |
| dashboard-notifications | 1 | 0 | 1 | 0% |

## 5. Root Causes

### 5.1 Error contracts are inconsistent

Some business rejections return a stable `code`, some return a bare English sentence, some return a
Thai sentence, and some build a dynamic template. The UI correctly treats all unreviewed server text
as untrusted, so useful but uncatalogued reasons are intentionally discarded.

### 5.2 The generic 400/422 fallback represents only one failure class

The sentence about screen data not matching the system is correct for a stale web/API DTO contract.
It is incorrect for ordinary field validation, plan limits, closed periods, missing setup, and
business workflow rules.

### 5.3 Source-derived coverage stops at the original launch scope

The current coverage gate enforces complete mappings only for expenses, reimbursements,
employee-access, auth, data-model-core, and system-partner-management. Newer CRM, procurement, tax,
inventory, inbox, data-rights, and feature-launch errors can be added without a matching customer
sentence.

### 5.4 Domain mappings are fragmented

Banking, tax diagnostics, workflow results, LINE delivery, accounts payable, and billing control
screens contain useful local renderers. The global audit cannot currently prove which API codes
they cover, and another screen calling the same endpoint may fall back differently.

### 5.5 Some reviewed copy still uses implementation vocabulary

Terms such as `Template`, `Preview`, `Auto-post`, `version`, and `artifact` appear in customer copy.
`Token`, `Channel ID`, `Tax Code`, `OCR`, and `Stripe` can be appropriate on specialist setup pages,
but should not be assumed to be understandable on owner/general-user screens. Copy needs to be
reviewed against the audience of the actual route rather than globally replacing every technical
term.

## 6. Recommended Fix Strategy

Do not translate all 323 missing identifiers in one blind batch. A wrong specific instruction is
worse than a safe generic one. Use these rules:

1. Every actionable business rejection gets a stable API code. Dynamic values belong in bounded
   `details`, not in the display sentence.
2. Customer copy answers three questions: what happened, why it matters, and what the user can do
   next.
3. Field problems render next to the known field and preserve entered values. Workflow/state
   problems use a persistent banner with the relevant destination. Temporary outages use retry
   copy. Permission failures name the appropriate administrator for that route.
4. Keep raw diagnostics in logs/error details and keep the current no-raw-display guard.
5. Extend source-derived coverage per active module and make it aware of approved domain
   translators. Adding a new user-facing code without reviewed copy should fail a focused test.
6. Use runtime frequency/support evidence to order the long tail after the confirmed journey gaps.

Suggested implementation batches:

1. **Common customer journeys:** dashboard notifications, inventory, ledger, accounting documents,
   CRM customer/contact/booking flows.
2. **Specialist workflows:** procurement, tax, CRM inbox, and banking; retain necessary accounting
   or provider terms but explain the recovery action in Thai.
3. **Operator workflows:** external signup, billing controls, data rights, feature launch, AI
   gateway, and onboarding. These need role-specific permission and provider/configuration copy.
4. **Long tail and prevention:** reconcile remaining codes, remove obsolete/unreachable entries,
   add module coverage gates, then run authenticated browser checks for representative 400, 409,
   422, and 503 cases.

## 7. Scope Limits

- This was static code and focused-renderer analysis; no production logs or error-frequency data
  were read.
- No authenticated browser runtime was started, so route reachability and visual placement were not
  verified in this audit.
- No additional API/web copy was changed as part of the system-wide review.

## 8. Default-open Remediation

After the audit, the user narrowed implementation to features in `DEFAULT_ENABLED_FEATURE_KEYS`,
plus billing/renewal. Public signup/onboarding is currently closed and excluded. The shared renderer
now uses neutral fallbacks for unknown 400/422, 409, 403, and 503 responses; reviewed code or
exact-message mappings cover the known in-scope business failures; and source-derived tests fail
when an in-scope code-like API identifier has no reviewed Thai copy.

Procurement, bank reconciliation, reports, inventory-only flows, sales/accounting documents,
data-rights, feature-launch, and public signup/onboarding remain audit findings only. The final
scoped renderer, coverage, no-raw-display, API client, and reimbursement suite passed 104/104 after
remediation; its source-derived gate checked 453 in-scope code-like identifiers.
