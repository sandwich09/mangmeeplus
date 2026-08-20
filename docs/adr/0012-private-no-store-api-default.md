# ADR 0012: Private No-Store by Default for ERP API Responses

## Status

Accepted (correctness and security fix, 2026-08-20)

## Context

ERP API representations depend on the signed-in user, company, permissions, entitlements, and mutable business state. Those dimensions are not part of a browser HTTP cache key. The employee role catalog exposed the failure mode: after `assignableByCurrentUser` was added, a client could receive a pre-flag representation and the strict picker filter interpreted every missing flag as denied, silently rendering no positions.

Maintaining a route allowlist of "session-sensitive" responses is not durable: almost every ERP route is contextual today, and a route can become contextual later without its URL changing.

## Decision

1. The Nest ERP API sets `Cache-Control: private, no-store, max-age=0` at the Express boundary for every response by default, including controller errors, parser failures, 404s, and optional Swagger responses.
2. Express-generated API ETags are disabled, so API responses cannot become implicit conditional `304` responses.
3. A deliberately public/cacheable API asset must replace `Cache-Control` explicitly in its controller and own regression evidence that the representation contains no tenant, session, permission, entitlement, or mutable private data. An explicit ETag must also be supplied if that route needs revalidation.
4. Next.js pages and static assets remain a separate web-process policy. Versioned Next assets and `/legal/releases/*` may keep long-lived immutable caching.
5. A client endpoint recovering from a previously cacheable contract may additionally use request `cache: 'no-store'` for the rollout, as the employee role catalog does.

## Consequences

### Positive

- New API routes fail safe without developers having to classify session/permission sensitivity correctly.
- Tenant or permission changes and additive response-contract changes cannot be hidden behind a stored browser representation.
- Static asset performance is unchanged.
- Disabling API ETag generation removes response-body hashing work.

### Trade-offs

- Repeated API GETs transfer their full response instead of using browser `304` revalidation, so large lists can use more bandwidth and may parse slightly slower on repeat navigation.
- The API already executes controllers and database queries before Express decides a conditional response, so this policy does not add that backend work; it mainly changes response transfer.
- The public LIFF page script currently uses `no-cache`; without an API ETag it transfers its small body on each load unless it later adopts an explicit public cache contract.

## Alternatives Considered

### Mark only auth/permission endpoints as no-store

Rejected: sensitivity is a property of representation inputs, not of URL naming, and changes over time. An allowlist would recreate the same omission risk.

### Keep browser caching and add permission/version values to cache keys

Rejected for the browser boundary: standard browser cache keys do not include the application's permission or entitlement version. If measurements later justify server-side caching, it must be private and keyed by company plus access-context/version, with explicit invalidation.

### Fall back to showing every role when the flag is absent

Rejected: it would restore the UI while offering roles the user may not grant and would hide an API contract mismatch. The web surfaces a load error instead.

## Implementation Notes

- Boundary: `apps/api/src/common/middleware/api-cache-control.middleware.ts`, registered before parsers in `apps/api/src/main.ts`.
- Role recovery: `apps/web/src/features/employee-access/employee-access.api.ts` requests `cache: 'no-store'` and validates the request-context role contract.
- Direct S3 presigned downloads and Next static/legal artifacts are outside the Nest API cache boundary.

## Test Requirements

- API regression proves the private no-store default and explicit override path.
- Client regression proves role requests bypass browser cache and reject a pre-flag response as `invalid_response`.
- API boot smoke and API/Web typechecks must pass.

## Follow-up Questions

- Measure only if users report or telemetry shows material repeat-navigation latency; optimize a measured large endpoint explicitly rather than weakening the global default.
