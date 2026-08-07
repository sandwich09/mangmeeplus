// Boundary shapes for the decimal-string fields that DTO classes accept (G1 —
// converting `@Body() body: any` handlers to validated DTOs). Money and
// quantities travel as strings end-to-end so Decimal precision survives JSON;
// these regexes only decide what the HTTP edge accepts, never what the domain
// computes.
//
// accounting-documents keeps its own copies in
// domain/logic/accounting-money-validation.logic.ts because those also back that
// module's arithmetic invariants. Do not merge the two: this file may only ever
// become more permissive (it guards existing, already-shipped payload shapes),
// while the accounting ones encode business rules.

/** Non-negative, up to 4 decimal places. Zero allowed — `'0'` and `'0.00'` are everywhere in real payloads. */
export const DECIMAL_STRING_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

/** Same, but signed — statement lines and adjustments carry negative amounts. */
export const SIGNED_DECIMAL_STRING_PATTERN = /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

/** Percentage rate, 0–999.9999. VAT/WHT rates are sent as `'7'`, not `'0.07'`. */
export const DECIMAL_RATE_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/;
