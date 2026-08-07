# ADR 0002: Inventory Negative Stock Policy

## Status

Accepted

## Context

WatchDog-BMS needs inventory data that SME owners can trust for daily operations, dashboards, alerts, and future accounting support.

The Inventory MVP plan defines stock movement records as the core inventory source of truth. If the system allows stock-out operations that make balance negative without a clear policy, users may lose confidence in inventory numbers and accounting reconciliation may become harder later.

Negative stock can happen in real businesses because of delayed data entry, sales before receiving stock, incorrect counts, or operational mistakes. However, allowing it by default in the MVP increases complexity and weakens the product promise of trustworthy stock.

## Decision

Block negative stock by default in the Inventory MVP.

For any stock-out or adjustment-out operation, the system must check the available balance for the selected product and location before creating a movement record.

If the requested quantity is greater than available balance, the operation must fail and return a clear error.

## Rules

- Stock-in and adjustment-in increase balance.
- Stock-out and adjustment-out decrease balance.
- Stock-out and adjustment-out must not reduce balance below zero.
- Quantity must be greater than zero.
- Adjustment-out requires reason text.
- Failed negative-stock attempts should be auditable when audit logging exists.
- Backdated movement support must not bypass the negative stock rule without a separate decision.

## Consequences

### Positive

- Stock balance stays easier to understand.
- Owner dashboards are more trustworthy.
- Inventory mistakes are surfaced immediately.
- Accounting support is easier to add later.
- MVP implementation has a clear default behavior.

### Trade-offs

- Some businesses that intentionally allow backorders may need a later configurable policy.
- Users may need to record stock-in before recording some sales or stock-out events.
- Backdated movement handling becomes stricter and may need a future workflow.

## Alternatives Considered

### Allow negative stock by default

Rejected for MVP because it can hide operational problems and make inventory reports less trustworthy.

### Allow negative stock with warning only

Rejected for MVP because warning-only behavior is easy to ignore and may create confusing balances.

### Configurable negative stock policy

Deferred. This may be useful later for businesses that support backorders, pre-orders, or delayed warehouse entry.

## Implementation Notes

- Balance should be checked inside the same trusted service or transaction that creates stock movement.
- Do not rely only on UI validation.
- API/service validation must enforce this rule.
- Error message should explain available quantity and requested quantity where appropriate.

## Test Requirements

- Stock-out succeeds when available balance is sufficient.
- Stock-out fails when requested quantity exceeds available balance.
- Adjustment-out fails when requested quantity exceeds available balance.
- Failed negative-stock operation does not create a stock movement record.
- Permission and audit behavior should be tested when platform foundation exists.

## Follow-up Questions

- Should some roles be allowed to override negative stock later?
- Should backorder workflows be modeled separately from stock-out?
- Should company/workspace settings support a configurable negative stock policy in a later phase?
