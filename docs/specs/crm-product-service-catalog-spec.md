# CRM Product and Service Catalog Spec

## Status

Implemented and focused-verified locally on 2026-07-12. Migration deploy, browser smoke, and real-model smoke remain live verification work.

## Goal

Give each company one maintained catalog of products and services so staff and CRM AI answer from the same source and staff can select a real service when creating a booking.

## Ownership and boundaries

- Reuse Inventory's existing `Product` aggregate. `Product.kind = SERVICE` represents a service; do not create a second CRM-only product table.
- Inventory owns catalog CRUD and audit/outbox behavior. CRM owns customer conversation and booking behavior.
- The ERP Core API selects bounded customer-visible catalog rows before calling AI Gateway. AI Gateway never reads Prisma or Inventory directly.
- A booking keeps the existing `serviceName` snapshot. A later rename must not rewrite historical appointments.

## Product rules

Each product may additionally define:

- `salePrice`: optional non-negative decimal in company currency.
- `bookingDurationMinutes`: optional 60-180 minutes in 30-minute steps; meaningful for `SERVICE`.
- `customerVisible`: explicit publication flag, default `false`.

Only rows with `status = ACTIVE` and `customerVisible = true` may enter customer-facing AI context or staff's customer-service selector. Archived or internal-only rows must never enter that context.

## User journeys

### CRM Settings

An authorized user opens **CRM Settings -> Products and Services**, lists/searches catalog rows, and creates or edits product/service details. The existing `inventory.product.read|manage` permissions remain authoritative and are available when either the `crm` or `inventory` feature is enabled. CRM-only access must not expose the Inventory workspace.

### Staff booking

The booking form loads active, customer-visible `SERVICE` rows. Choosing one fills the canonical service name and its standard duration. If no published service exists, the form shows an honest link to configure the catalog rather than demo service names.

### CRM AI

- General product/service questions receive a bounded catalog containing only published rows, including description, unit, price, and service duration when present.
- Booking extraction receives only published services and must return a catalog item id when the customer identifies a service.
- ERP Core validates the returned id against the same company-scoped catalog, uses its canonical name/duration, and asks the customer to choose when no published service matches. The model may not invent price, availability, or service names.

## Acceptance criteria

- [x] CRM Settings has a permission-gated Products and Services menu and CRUD surface.
- [x] Publication defaults off and internal/archive rows do not reach customer AI.
- [x] Staff booking selects a published service and applies its standard duration.
- [x] CRM reply and booking AI requests carry a bounded published catalog assembled by ERP Core.
- [x] AI-selected service ids are revalidated before booking mutation.
- [x] Focused contract, API/domain, AI prompt, web navigation, and type checks pass.
- [ ] Migration deploy, browser journey, and real-model catalog answer/booking are live-proven.
