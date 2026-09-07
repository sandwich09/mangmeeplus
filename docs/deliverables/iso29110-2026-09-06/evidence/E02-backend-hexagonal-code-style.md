# Backend Hexagonal Code Style Guideline

## Status

Accepted

## Goal

Keep backend services maintainable by separating business logic, use cases, repositories, queries, database adapters, and models using hexagonal architecture.

This guideline applies to:

- `apps/api`
- `apps/ai-gateway`
- `apps/workers` when workers contain business use cases

## Architecture Rule

Backend modules must use inward-facing dependencies.

Allowed direction:

```text
presentation -> application -> domain
infrastructure -> application/domain ports
```

Domain and application code must not import HTTP controllers, ORM clients, framework adapters, queues, or external SDKs directly.

## Module Folder Rule

Every bounded context or feature must live in its own module folder.

Example:

```text
apps/api/src/modules/inventory/
  domain/
    models/
      product.model.ts
    logic/
      stock-balance.logic.ts
    ports/
      product.repository.port.ts
  application/
    use-cases/
      create-product.use-case.ts
      list-products.use-case.ts
    dto/
      create-product.input.ts
  infrastructure/
    db/
      inventory.prisma.mapper.ts
    repositories/
      prisma-product.repository.ts
    queries/
      product-list.query.ts
  presentation/
    http/
      inventory.controller.ts
  inventory.module.ts
```

Shared backend code must live under:

```text
apps/api/src/common/
apps/ai-gateway/src/common/
```

## Separation Rule

Do not mix HTTP, use case logic, domain logic, database access, and query shaping in one file.

Use this default split:

- `presentation/http/*.controller.ts`: REST controllers and request/response wiring only.
- `application/use-cases/*.use-case.ts`: one business action or workflow per class/function.
- `application/dto/*.ts`: use case inputs and outputs.
- `domain/models/*.model.ts`: domain types, entities, value objects, and enums.
- `domain/logic/*.logic.ts`: pure domain rules and calculations.
- `domain/ports/*.port.ts`: interfaces for repositories, queues, storage, external systems, and clocks.
- `infrastructure/repositories/*.repository.ts`: write/read repository implementations through Prisma or other persistence adapters.
- `infrastructure/queries/*.query.ts`: optimized read models, list queries, reports, filters, and projections.
- `infrastructure/db/*.mapper.ts`: ORM/database mapping between persistence records and domain models.

## Use Case Rule

Controllers must call use cases, not repositories directly.

Use cases own orchestration:

- validate use case input
- load records through ports/repositories
- call pure domain logic
- enforce permissions when required by the use case
- write through repositories
- emit outbox events or queue jobs through ports

Use cases should not know HTTP request/response details.

## Repository Rule

Repositories are for persistence operations tied to domain models.

Examples:

- `CompanyRepository`
- `ProductRepository`
- `StockMovementRepository`
- `AuditLogRepository`

Repositories should expose business-oriented methods, not raw table access everywhere.

## Query Rule

Queries are for read models and reporting views.

Examples:

- `ProductListQuery`
- `StockBalanceQuery`
- `DashboardSummaryQuery`

Queries may optimize for UI/API output, pagination, filtering, sorting, joins, and projections.

Do not put complex reporting queries inside use cases or controllers.

## Database Rule

Database/ORM code belongs in `infrastructure/db`, `infrastructure/repositories`, or `infrastructure/queries`.

Prisma client usage must not leak into:

- controllers
- domain logic
- domain models
- pure use case tests

Use mappers when persistence shape differs from domain shape.

## Migration Guard Rule

When a migration creates database objects that can be recreated or retried outside Prisma's normal migration ledger, add existence guards where PostgreSQL supports them.

Default pattern:

- Use `DROP TRIGGER IF EXISTS ... ON ...` before `CREATE TRIGGER`.
- Use `CREATE OR REPLACE FUNCTION` for migration-managed functions.
- Use `DROP INDEX IF EXISTS` only when intentionally replacing an index.

Do not make every Prisma migration fully idempotent by default. Add guards for retry-prone object creation, especially triggers/functions/index replacement, while keeping normal table/enum creation aligned with Prisma migration history.

## Model Rule

Domain models should express business meaning.

Do not use Prisma generated types as domain models.

Persistence models and API DTOs can change independently from domain models.

## Common-First Rule

Before creating new backend code:

1. Check service-local `src/common/`.
2. Check existing module ports, queries, repositories, and logic.
3. Reuse common code if behavior is shared.
4. Create module-local code only when behavior belongs to one module.
5. Move code to `common` when a second module needs it.

Do not duplicate repository helpers, auth utilities, pagination helpers, date utilities, or error mapping across modules.

## Constant Reuse Rule

Values reused across files or modules must be named constants so changes and root-cause analysis have one obvious place to start.

Default homes:

- Module-local constants stay inside the owning module while only one module uses them.
- Shared constants move to service-local `src/common/` when a second module needs them.
- Contract values shared outside the service belong in the shared contract package or source-of-truth spec.

Use constants for permission keys, status values, event names, queue names, pagination defaults, retry limits, date/window defaults, and other repeated business or integration values.

Do not create constants for one-off obvious literals, throwaway test data, or values that are clearer inline.

## Naming Rule

Use explicit suffixes:

- `*.model.ts`
- `*.logic.ts`
- `*.port.ts`
- `*.use-case.ts`
- `*.input.ts`
- `*.output.ts`
- `*.repository.ts`
- `*.query.ts`
- `*.mapper.ts`
- `*.controller.ts`
- `*.module.ts`

Use action-based use case names:

- `create-product.use-case.ts`
- `approve-reimbursement.use-case.ts`
- `calculate-stock-balance.use-case.ts`

## Testing Rule

Test pure domain logic without NestJS or database.

Test use cases with fake ports/repositories first.

Test infrastructure repositories and queries separately with database-backed integration tests.

Test controllers as thin integration tests after use cases are covered.

## Review Checklist

- [ ] Controller does not contain business logic.
- [ ] Controller calls use case, not repository/query directly.
- [ ] Use case does not import HTTP framework objects.
- [ ] Domain logic is pure and framework-free.
- [ ] Domain model does not depend on Prisma generated types.
- [ ] Repository code is inside `infrastructure/repositories`.
- [ ] Query/report code is inside `infrastructure/queries`.
- [ ] ORM mapping is inside `infrastructure/db`.
- [ ] DB migrations guard retry-prone trigger/function/index recreation with `IF EXISTS` / `CREATE OR REPLACE` where appropriate.
- [ ] Shared behavior was checked in `common` before new code was added.
- [ ] Reused values are named constants and shared from the right module/common/contract home.
- [ ] Dependencies point inward toward domain/application.
