# ADR 0004: Inventory Movement Immutability

## Status

Accepted

## Context

WatchDog-BMS needs inventory records that can be trusted by owners, inventory staff, finance users, dashboards, alerts, and future AI assistant workflows.

Inventory balance is derived from stock movement records according to ADR 0003. If users or system processes can edit or delete old movement records directly, the historical explanation of stock balance becomes unreliable.

Real businesses still need to correct mistakes. A user may enter the wrong quantity, wrong product, wrong location, wrong movement type, or wrong reason. The system must support corrections without rewriting history.

## Decision

Stock movement records are immutable after creation.

Do not allow direct edit or destructive delete of `StockMovement` records.

Corrections must be made through new movement records, such as adjustment movements or reversal movements, with a required reason.

## Rules

- A created stock movement must not be edited.
- A created stock movement must not be hard-deleted through normal product behavior.
- Corrections must create a new movement record.
- Adjustment movements require reason text.
- Reversal movements, when implemented, must reference the original movement.
- Movement history must show both the original movement and the correction.
- Balance calculation must include all valid movement records.
- Any exceptional admin-only data repair must be outside normal product flow and must be separately audited.

## Correction Patterns

### Adjustment

Use adjustment when the current stock quantity needs to be corrected and the exact original mistake is not being reversed.

Examples:

- Physical stock count finds 8 units but system shows 10.
- Staff discovers stock was damaged or missing.
- Initial stock was entered too low or too high.

### Reversal

Use reversal when a specific previous movement should be cancelled out.

Examples:

- User recorded stock-out for the wrong product.
- User accidentally entered the same stock-in twice.
- User selected the wrong location for a movement.

Reversal can be deferred in MVP if adjustment is sufficient, but the model should not rely on editing the original movement.

## Consequences

### Positive

- Inventory history remains auditable.
- Stock balance can always be explained by movement records.
- Mistakes are visible instead of hidden.
- Future accounting and reporting workflows are safer.
- AI assistant can reason from a stable event history.

### Trade-offs

- Movement history may contain more records.
- Users need a clear correction UI to avoid confusion.
- Reports may need to group original and reversal movements later.
- Admin data repair needs a separate process for rare exceptional cases.

## Alternatives Considered

### Allow editing recent movement records

Rejected for MVP because it weakens auditability and can make historical reports inconsistent.

### Allow soft delete of movement records

Rejected as normal product behavior because hidden or excluded records can make balance explanations confusing.

### Allow hard delete for admin users

Rejected for normal product behavior. Rare database repair should be treated as an exceptional operational process, not a user-facing feature.

## Implementation Notes

- Do not expose update/delete APIs for normal stock movement records.
- If the framework generates default CRUD endpoints, disable update/delete for movement records.
- Store actor, timestamp, movement type, quantity, product, location, and reason on every movement.
- If reversal is implemented, add `reversesMovementId` or equivalent reference.
- If cancellation is required later, model it as a new domain event rather than modifying the original record.
- UI should label corrections clearly so users understand why balance changed.

## Test Requirements

- Creating a movement succeeds with valid data.
- Updating a movement through normal API/service behavior fails or is unavailable.
- Deleting a movement through normal API/service behavior fails or is unavailable.
- Adjustment creates a new movement record and changes derived balance.
- Reversal, when implemented, creates a new linked movement record.
- Movement history shows original and correction records.

## Follow-up Questions

- Should reversal be included in Inventory MVP or deferred after adjustment support?
- Should movement history have a visible correction chain in UI?
- Which roles can create adjustment or reversal movements?
- Should exceptional data repair require an operations runbook and separate audit log?
