# CRM Product and Service Catalog Implementation Plan

## Scope

Implement the owner-approved catalog in the shortest path by extending the existing Inventory `Product` aggregate and wiring it into CRM Settings, staff booking, and CRM customer AI.

## Steps

1. Extend Product persistence/contracts with `salePrice`, `bookingDurationMinutes`, and `customerVisible`; validate price and duration at the API boundary.
2. Add CRM Settings navigation and reuse the existing product CRUD UI with product/service wording and publication fields.
3. Replace booking demo service choices with active customer-visible `SERVICE` rows and apply the selected standard duration.
4. Assemble a bounded published catalog in ERP Core, pass it to reply/booking agents, and validate the selected service before mutation.
5. Add focused tests, run contracts/API/web/AI checks, then update the checklist and task memory with actual evidence.

## Deliberate limits

- No second catalog table and no new dependency.
- No branch-specific pricing, variants, promotions, packages, or online storefront.
- No booking-to-product foreign key in this slice; `serviceName` remains the historical snapshot.
- No stock-availability claim in customer AI; catalog presence is not stock availability.

