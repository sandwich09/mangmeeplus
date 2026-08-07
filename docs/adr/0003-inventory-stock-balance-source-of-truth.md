# ADR 0003: Inventory Stock Balance Source of Truth

## Status

Accepted

## Context

The Inventory MVP requires users to view current stock balance and review movement history. The system must decide whether stock balance is stored directly, calculated from stock movements, or maintained as a cached projection.

Stock balance is business-critical because it affects sales, purchasing, owner dashboards, low-stock alerts, and future accounting workflows.

If balance is stored as an independent editable value, it can drift from movement history and become difficult to audit. The product direction prioritizes trust, auditability, and clear source-of-truth records.

## Decision

Use stock movement records as the source of truth for inventory balance in the MVP.

Current stock balance must be derived from movement records.

Do not make stock balance directly editable. Balance changes must happen only through stock movements such as stock-in, stock-out, adjustment-in, or adjustment-out.

## Rules

- Stock movement records are append-only after creation.
- Current balance is calculated by summing movement quantities by product and location.
- Incoming movement types add to balance.
- Outgoing movement types subtract from balance.
- Manual balance edits are not allowed.
- Corrections must be recorded as adjustment movements with reason text.
- Cached balance may be introduced later only as a derived optimization, not as the canonical record.

## Consequences

### Positive

- Inventory history is auditable.
- Current balance can be explained by source records.
- Mistakes can be corrected without rewriting history.
- Future reporting and accounting reconciliation are easier.
- MVP avoids cache invalidation complexity.

### Trade-offs

- Balance queries may become slower as movement volume grows.
- Reports may need optimized queries or projections later.
- Backdated movements may require careful recalculation or reporting rules.

## Alternatives Considered

### Store stock balance as canonical value

Rejected because direct balance storage can drift from history and makes auditability weaker.

### Maintain stock balance cache from day one

Deferred because the MVP should prioritize correctness and simpler business rules before performance optimization.

### Event sourcing for all inventory events

Partially accepted in spirit. Stock movements act as inventory events, but the MVP does not require a full event-sourcing architecture.

## Implementation Notes

- Start with movement-derived balance calculation.
- Use database constraints and service validation where possible.
- If a cached balance table is added later, it must be rebuildable from movement records.
- Balance calculation should be scoped by company/workspace, product, and location.
- UI should show movement history so users can understand why balance changed.

## Test Requirements

- Stock-in increases derived balance.
- Stock-out decreases derived balance.
- Adjustment-in increases derived balance.
- Adjustment-out decreases derived balance.
- Movement history totals match balance view.
- Direct balance mutation is not available through API/service behavior.

## Follow-up Questions

- When movement volume grows, should the system add a cached `StockBalance` projection?
- Should balance calculation live in SQL/query layer or domain service?
- How should backdated movements affect historical reports?
- Should transfer be modeled as linked out/in movements or a separate movement type?
